# Notas técnicas del challenge

Decisiones de implementación y resultados de las pruebas. Para levantar la API y usar Postman, ver el [README](../README.md). El [PDF de diagramas](diagrams/Cocos_Diagramas_Tecnicos.pdf) muestra las relaciones del esquema y los flujos HTTP.

## Estructura del backend

Elegí un monolito modular con NestJS. Hay un proceso, una base y módulos por funcionalidad. Los controladores validan la entrada, los servicios coordinan los casos de uso y los repositorios concentran el SQL parametrizado que ejecuta `pg`. Las reglas de disponibilidad viven en `src/account` y se usan desde cartera y órdenes. Eso permite probarlas con datos simples y mantener el mismo cálculo en los dos flujos.

El esquema mantiene `users`, `instruments`, `orders` y `marketdata`. Agregué `order_idempotency` para recuperar el resultado de un envío. `orders` sigue siendo la fuente de efectivo, tenencias y reservas. En el esquema provisto, la fecha de cotización es `marketdata.date`. La fecha de una orden se guarda en `orders.datetime`.

## Instrumentos

El catálogo y la búsqueda se consultan con `GET /instruments`: ambos leen la misma colección y devuelven `items` y `pagination`. `query` es opcional y se combina con `page` y `pageSize`. Si se envía vacío, repetido o con un carácter nulo, devuelve `400`. ARS y los demás instrumentos `MONEDA` quedan fuera porque representan efectivo.

PostgreSQL aplica el filtro de texto con `ILIKE` parametrizado y escapa los comodines. Ordena primero por coincidencia exacta de ticker cuando hay filtro y desempata por ticker e ID. La página y el total salen de la misma consulta con el mismo filtro. Por defecto devuelve la página 1 con hasta 20 instrumentos, y el máximo es 100. Una página fuera de rango devuelve `items: []` con los totales de la consulta.

## Tiempos de espera y recuperación

El pool usa `connectionTimeoutMillis = 5000`, `lock_timeout = 5000`, `statement_timeout = 10000` y `query_timeout = 15000`. El primero acota la adquisición de conexiones. PostgreSQL cancela la sentencia si tarda demasiado o no consigue un bloqueo. El límite del cliente cubre el caso en que el servidor deja de responder, como un contenedor pausado. Los valores iniciales están centralizados en `src/database/database-timeouts.ts` y se ajustarían con mediciones.

Las consultas GET y las órdenes devuelven `503 DATABASE_UNAVAILABLE` ante esos fallos, con el mismo formato de error y el ID de la petición. Una sentencia cancelada dentro de una transacción lleva a `ROLLBACK`. Si el cliente agota la espera o pierde la conexión, se descarta esa conexión. Cerrar el socket no garantiza que el backend deje de ejecutar instantáneamente la sentencia. PostgreSQL revierte la transacción abierta al procesar la desconexión. Tampoco se devuelve al pool una conexión cuyo rollback falló. Los errores de conexiones inactivas se registran para evitar que terminen el proceso de Node.

Si falla la respuesta de `COMMIT`, puede haber una orden confirmada aunque la API responda `503`. El cliente debe reintentar con la misma clave de idempotencia y el mismo cuerpo. Si el registro existe, recupera el resultado. Si la transacción se revirtió, puede crear la orden. La API no reintenta escrituras por su cuenta. Cada límite corresponde a una operación, por lo que no representa un máximo global de duración del endpoint.

Las regresiones cubren consultas lentas, GET bloqueado, orden bloqueada con su clave libre para reintentar, rollback de una escritura después del timeout del cliente y un servidor TCP que acepta la conexión sin responder al protocolo PostgreSQL. También verifican el descarte de conexiones ante timeout de lectura, rollback fallido y confirmación incierta.

## Cartera

El **efectivo contable** suma depósitos y ventas ejecutadas, y resta retiros y compras ejecutadas. Para calcular los **pesos disponibles**, se restan las compras LIMIT en `NEW`. Las ventas LIMIT en `NEW` reservan acciones. Las posiciones y el patrimonio reflejan los movimientos ejecutados. Una LIMIT en `FILLED` se contabiliza como una ejecución y deja de generar reserva. Las órdenes canceladas y rechazadas quedan fuera del cálculo.

El **valor total** suma efectivo contable y posiciones al último cierre fechado. Se desempata por ID cuando dos cotizaciones tienen la misma fecha. Si el cierre elegido falta o es inválido, la posición se mantiene con valor y rendimiento nulos. El total también es nulo y se siguen informando los pesos disponibles. Una fila pertinente con un dato necesario ausente interrumpe el cálculo para evitar que se opere con un saldo incorrecto.

El **rendimiento de una posición abierta** se calcula como `(cierre - costo promedio) / costo promedio × 100`. El costo promedio se actualiza con compras ejecutadas, se mantiene en una venta parcial y se reinicia al cerrar la posición. La tenencia histórica de −10 acciones se muestra con signo, se valúa si hay un cierre y tiene rendimiento nulo. La disponibilidad para vender tiene piso cero.

## Órdenes, concurrencia y reintentos

El controlador valida usuario, instrumento, lado y tipo. Acepta cantidad o monto, y exige precio en una LIMIT. Una orden por monto calcula acciones enteras con el precio aplicable. En una compra se valida el monto pedido y se registra o reserva el costo de las acciones resultantes. En una venta se comprueba la cantidad calculada contra las acciones libres.

Cada envío abre una transacción `READ COMMITTED` y bloquea `users.id` con `SELECT ... FOR UPDATE` antes de leer el historial. La siguiente solicitud del mismo usuario espera y puede ver los movimientos confirmados por la primera. Si la orden supera los recursos disponibles, se guarda como `REJECTED` con su motivo. Los errores que impiden procesar una orden, como una MARKET sin cierre o un instrumento `MONEDA`, terminan sin insertar. Una falla durante el alta revierte la transacción.

La orden nueva toma `statement_timestamp()` en el INSERT, ya con el bloqueo adquirido. `now()` tomaba el inicio de la transacción y podía invertir el historial cuando una compra adquiría el bloqueo antes que una venta que había iniciado primero. El orden `datetime, id` es importante para reconstruir el costo promedio.

Si el cliente manda `Idempotency-Key`, el servicio busca la clave **después del bloqueo y antes de consultar precio o disponibilidad**. PostgreSQL garantiza unicidad por `(userid, key)`. El registro guarda la orden asociada, una representación normalizada de la solicitud y el resultado original. La orden y ese registro se confirman juntos.

- **Misma clave y mismos datos.** Se repite el ID, estado y motivo original, incluso si la orden quedó `REJECTED`. Se conserva el efecto de la primera orden.
- **Misma clave y datos distintos.** Devuelve `409 IDEMPOTENCY_KEY_REUSED`. Cantidad y monto son solicitudes distintas aunque den el mismo número de acciones.
- **Sin orden persistida.** La clave sigue libre. Por ejemplo, una MARKET sin cotización puede reintentarse cuando aparezca un cierre válido.
- **Sin header.** Cada POST se procesa como una solicitud independiente.

La clave distingue mayúsculas y admite hasta 128 letras, dígitos, puntos, guiones o guiones bajos. Se compara la solicitud normalizada. Por ejemplo, `"800.0"` y `"800.00"` representan el mismo monto en centavos. Cada intento recibe su propio `X-Request-Id`. Ese ID correlaciona la respuesta con los logs. Las validaciones propias informan el campo del error de forma explícita.

## Qué verifiqué

Las pruebas de integración y E2E se ejecutaron con PostgreSQL 16 local desechable, separado de la base de desarrollo. Pasaron lint, compilación y **160 pruebas en 19 archivos**. Estos fueron los casos principales que revisé:

| Escenario | Resultado observado |
|---|---|
| PostgreSQL pausado con una conexión ya abierta | GET devuelve `503 DATABASE_UNAVAILABLE` a los 15,04 segundos. Al reanudar PostgreSQL, vuelve a responder `200`. |
| Orden que agota la espera del bloqueo | Devuelve `503`, no guarda la orden ni consume la clave. El reintento con la misma clave reserva una sola vez. |
| Dos compras de $800 con $1.000 disponibles y sin clave | Una `FILLED`, una `REJECTED` y $200 disponibles. |
| Una venta inicia primero, pero una compra adquiere antes el bloqueo | El historial queda BUY → BUY → SELL. Quedan 10 acciones con rendimiento de 33,33%. |
| Dos compras concurrentes de $800 con la misma clave y $2.000 disponibles | Mismo ID en ambas respuestas, una orden y $1.200 disponibles. |
| Falla al guardar el registro de idempotencia | Se revierte también la inserción de la orden. |
| Aplicar dos veces el SQL de actualización sobre una copia del esquema anterior | Se crea la tabla y se conservan las 11 órdenes originales. |
| Búsqueda con `GG%00AL` y catálogo con página fuera de rango | La búsqueda devuelve 400 y el catálogo devuelve 200 con una lista vacía y los totales. |

También ejecuté las tres colecciones exportadas. Fueron 46 solicitudes y 107 comprobaciones, sin fallas.

Para probar escrituras por HTTP, la [demo local](../README.md#demo-con-postman) usa `cocos_orders_demo`. Las suites automatizadas toman `TEST_DATABASE_URL`. La base Neon del challenge se inspeccionó en modo solo lectura.
