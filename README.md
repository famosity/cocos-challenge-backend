# Challenge backend de Cocos Capital

API REST para buscar instrumentos, consultar la cartera de un usuario y enviar órdenes de compra o venta. Está hecha con NestJS, TypeScript y PostgreSQL. Los datos de ejemplo se cargan desde `database.sql`.

## Índice

- [Arranque local](#arranque-local)
- [Endpoints](#endpoints)
- [Demo con Postman](#demo-con-postman)
- [Pruebas](#pruebas)
- [Documentación técnica](#documentación-técnica)

## Arranque local

Necesitás **Node.js 22**, npm y Docker Desktop. Con Docker abierto, ejecutá desde la raíz del repositorio:

```text
npm ci
npm run db:up
```

Si todavía no tenés un `.env`, copiá `.env.example` a `.env`. La URL de ejemplo apunta a la base local `cocos`. Docker carga el esquema y la semilla cuando crea el volumen por primera vez.

```text
npm run dev
```

La API de desarrollo queda en `http://localhost:3000`. Para confirmar que lee la base, abrí `http://localhost:3000/instruments?query=ggal`. Para correr la versión compilada, usá `npm run build` y luego `npm run start:prod`.

## Endpoints

| Método y ruta | Qué devuelve |
|---|---|
| `GET /instruments` | Lista instrumentos operables. `query` filtra por ticker o nombre y se puede combinar con `page` y `pageSize`. |
| `GET /users/1/portfolio` | Informa el valor total de la cuenta, los pesos disponibles y las posiciones con cantidad, valor y rendimiento. |
| `POST /orders` | Guarda una orden BUY o SELL. Si se persiste, devuelve `201` con el ID y el estado. |

Usá `GET /instruments` para abrir el catálogo o `GET /instruments?query=galicia&page=1&pageSize=10` para buscar. Ambos devuelven `items` y `pagination` con `page`, `pageSize`, `totalItems` y `totalPages`. El total cuenta las coincidencias antes de paginar. Los valores por defecto son página 1 y tamaño 20, con un máximo de 100 por página. Si la página queda fuera del rango, `items` está vacío y los totales se conservan. Un `query` vacío devuelve `400`. ARS representa el efectivo de la cuenta y queda fuera de los instrumentos operables.

Ejemplo de una compra MARKET de una acción de GGAL, instrumento 34 en la semilla:

```json
{
  "userId": 1,
  "instrumentId": 34,
  "side": "BUY",
  "type": "MARKET",
  "quantity": 1
}
```

Podés mandar `quantity` o `amount`. Los importes se envían como texto decimal, por ejemplo `"950.00"`. Para una LIMIT también enviá `price`. Una MARKET aceptada queda `FILLED` al último cierre. Una LIMIT aceptada queda `NEW` y reserva pesos o acciones. Si la orden se rechaza por falta de disponibilidad, igual se guarda y el cuerpo informa `REJECTED` y el motivo.

**Para reintentar una orden**, mandá un header `Idempotency-Key`, por ejemplo `demo-ggal-01`. Con el mismo usuario, la misma clave y los mismos datos, el POST devuelve el resultado original. Cambiar la cantidad con esa clave devuelve `409 IDEMPOTENCY_KEY_REUSED`. Si omitís el header, cada POST es una solicitud independiente.

## Demo con Postman

Para probar órdenes que se guarden, usá una base local de demo. El [script de Windows](delivery/orders-demo.ps1) levanta PostgreSQL, prepara `cocos_orders_demo` y arranca otra instancia de la API en el puerto 3001:

```bat
powershell -NoProfile -File delivery\orders-demo.ps1
```

Importá el [entorno local](delivery/postman/local.postman_environment.json) en Postman y seleccioná `baseUrl = http://127.0.0.1:3001`. Estas son las colecciones:

- [Smoke](delivery/postman/cocos-smoke.postman_collection.json). Comprueba búsqueda, paginación, cartera y errores antes de operar. Sus solicitudes dejan intactas las órdenes.
- [Órdenes válidas](delivery/postman/cocos-orders.postman_collection.json). Prueba compras y ventas por cantidad y por monto. Ejecutala sobre la semilla inicial porque crea órdenes.
- [Idempotencia](delivery/postman/cocos-idempotency.postman_collection.json). Prueba reintentos, conflictos y solicitudes independientes. Incluye casos que crean órdenes.

Para correr el smoke desde la terminal:

```text
npx newman run delivery/postman/cocos-smoke.postman_collection.json -e delivery/postman/local.postman_environment.json
```

Para repetir una colección que escribe con la semilla inicial, detené la API con `Ctrl+C` y ejecutá `powershell -NoProfile -File delivery\orders-demo.ps1 -Reset`. El reinicio borra y vuelve a cargar únicamente `cocos_orders_demo`. Con `-PrepareOnly` podés preparar la base y revisar el conteo de órdenes antes de arrancar la API.

## Pruebas

`npm run test:check` corre las pruebas unitarias sin cobertura. Para ejecutar las pruebas que usan PostgreSQL, prepará una base local separada. Si todavía no existe, corré lo siguiente con el contenedor levantado:

```text
docker compose exec -T postgres psql -U cocos -d cocos -v ON_ERROR_STOP=1 -c "CREATE DATABASE cocos_test;"
docker compose exec -T postgres psql -U cocos -d cocos_test -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/01-database.sql
```

Agregá esta línea a `.env`:

```dotenv
TEST_DATABASE_URL=postgresql://cocos:cocos@127.0.0.1:5432/cocos_test
```

```text
npm run test:db
npm run test:all
npm run lint
npm run build
```

Las suites de base, integración y E2E requieren `TEST_DATABASE_URL`. Si falta, se detienen antes de preparar datos. La última corrida funcional pasó **140 pruebas en 16 archivos** contra PostgreSQL desechable.

Si tu base local existía antes de la idempotencia, podés agregar la tabla sin recargar la semilla. Este ejemplo actualiza `cocos_test`. El script de demo hace la misma preparación para `cocos_orders_demo`.

```powershell
Get-Content delivery/order-idempotency.sql -Raw | docker compose exec -T postgres psql -X -U cocos -d cocos_test -v ON_ERROR_STOP=1 -f -
```

## Documentación técnica

- [Notas técnicas](delivery/tecnico.md). Explican el modelo, el cálculo de cartera, la transacción de órdenes y la idempotencia.
- [Diagramas técnicos (PDF)](delivery/diagrams/Cocos_Diagramas_Tecnicos.pdf). Muestran las relaciones del esquema, el flujo de cada endpoint, el caso de concurrencia de la cartera y el manejo de reintentos.
