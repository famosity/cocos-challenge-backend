# Challenge backend de Cocos Capital

API REST para buscar instrumentos, consultar la cartera de un usuario y enviar órdenes de compra o venta. Está desarrollada con NestJS, TypeScript y PostgreSQL. El esquema y los datos iniciales están en `database.sql`.

## Índice

- [Preparar el proyecto](#preparar-el-proyecto)
- [Conectar la API a Neon](#conectar-la-api-a-neon)
- [Usar PostgreSQL local](#usar-postgresql-local)
- [Demo con Postman](#demo-con-postman)
- [Endpoints](#endpoints)
- [Límites de espera de PostgreSQL](#límites-de-espera-de-postgresql)
- [Pruebas](#pruebas)
- [Actualizar una base local existente](#actualizar-una-base-local-existente)
- [Documentación técnica](#documentación-técnica)

## Preparar el proyecto

Se requiere Node.js 22 y npm. Los comandos utilizan PowerShell y se ejecutan desde la raíz del repositorio.

Los ejemplos locales utilizan Docker Desktop para ejecutar PostgreSQL. También puedes usar una instalación propia y configurar las conexiones correspondientes. Para acceder a Neon o ejecutar las pruebas unitarias basta con Node.js, npm y la configuración indicada en cada sección.

Instala las dependencias.

```powershell
npm ci
```

Cada entorno tiene una base con un propósito distinto.

| Uso                                          | Base de datos                                 | Dirección de la API                             |
| -------------------------------------------- | --------------------------------------------- | ----------------------------------------------- |
| Consultar los datos proporcionados por Cocos | Neon, con la conexión recibida                | `http://localhost:3000`                         |
| Desarrollo local                             | `cocos`                                       | `http://localhost:3000`                         |
| Probar órdenes con Postman                   | `cocos_orders_demo`                           | `http://localhost:3001`                         |
| Pruebas automatizadas con PostgreSQL         | `cocos_test`, definida en `TEST_DATABASE_URL` | Las pruebas crean su propia instancia de NestJS |

`DATABASE_URL` selecciona la base de la aplicación y `PORT` define el puerto, cuyo valor predeterminado es 3000. Puedes guardar ambas variables en `.env` o definirlas en la terminal. Las variables de la terminal tienen prioridad. Para eliminarlas y volver a utilizar `.env`, detén la API y ejecuta lo siguiente antes de iniciarla de nuevo.

```powershell
Remove-Item Env:DATABASE_URL, Env:PORT -ErrorAction SilentlyContinue
```

`npm run dev` recompila y reinicia la API al guardar cambios. Al finalizar el inicio, el mensaje `Listening on` muestra la dirección y el puerto. Si aparece `[::1]`, puedes utilizar `localhost` con ese mismo puerto. Para ejecutar la versión compilada, utiliza `npm run build` y después `npm run start:prod`.

## Conectar la API a Neon

La aplicación se ejecuta en tu equipo y accede a la base remota. Si aún no tienes `.env`, créalo a partir del ejemplo.

```powershell
Copy-Item .env.example .env
```

Abre `.env` y sustituye `DATABASE_URL` por la cadena de conexión de Neon. Conserva todos sus parámetros, incluido `sslmode` si está presente. El archivo debe tener este formato, con tu conexión en lugar del texto de ejemplo.

```dotenv
DATABASE_URL=CADENA_DE_CONEXION_DE_NEON
PORT=3000
```

Guarda el archivo e inicia la API.

```powershell
npm run dev
```

Comprueba la lectura de los datos en `http://localhost:3000/instruments?query=ggal` o `http://localhost:3000/users/1/portfolio`.

Las órdenes se guardan en la base seleccionada por `DATABASE_URL`. Para experimentar con compras, ventas e idempotencia, utiliza la [demo local](#demo-con-postman). El archivo `.env` está excluido de Git para mantener las credenciales fuera del repositorio.

## Usar PostgreSQL local

Abre Docker Desktop e inicia PostgreSQL.

```powershell
npm run db:up
```

Al crear el volumen por primera vez, Docker carga `database.sql` en la base `cocos`. Los siguientes inicios conservan su contenido. Si la base se creó antes de incorporar idempotencia, consulta la [actualización de bases existentes](#actualizar-una-base-local-existente).

Configura la conexión local e inicia la aplicación.

```powershell
$env:DATABASE_URL = 'postgresql://cocos:cocos@127.0.0.1:5432/cocos'
$env:PORT = '3000'
npm run dev
```

Comprueba la respuesta en `http://localhost:3000/instruments`.

## Demo con Postman

Con Docker Desktop abierto, ejecuta el script de Windows. Prepara `cocos_orders_demo`, incluye la tabla de idempotencia y configura la API en el puerto 3001, aunque `.env` contenga otra conexión.

```powershell
powershell -NoProfile -File delivery\orders-demo.ps1
```

El script crea la base y carga los datos iniciales si todavía no existe. En ejecuciones posteriores conserva las órdenes creadas. Con `-PrepareOnly`, prepara la base y muestra el número de órdenes sin iniciar la API.

Importa el [entorno local](delivery/postman/local.postman_environment.json) en Postman y selecciónalo. Su variable `baseUrl` apunta a `http://127.0.0.1:3001`. Las solicitudes y los scripts previos usan esa variable. Si pruebas la API del puerto 3000, cambia su valor a `http://localhost:3000`.

| Colección                                                                  | Qué comprueba                                        |
| -------------------------------------------------------------------------- | ---------------------------------------------------- |
| [Smoke](delivery/postman/cocos-smoke.postman_collection.json)              | Búsqueda, paginación, cartera y errores.             |
| [Órdenes válidas](delivery/postman/cocos-orders.postman_collection.json)   | Compras y ventas por cantidad y por importe.         |
| [Idempotencia](delivery/postman/cocos-idempotency.postman_collection.json) | Reintentos, conflictos y solicitudes independientes. |

Ejecuta las solicitudes en el orden de cada colección y parte de los datos iniciales para obtener los resultados esperados. Las colecciones de órdenes e idempotencia crean registros. Para restaurar la demo, detén la API con `Ctrl+C` y ejecuta lo siguiente.

```powershell
powershell -NoProfile -File delivery\orders-demo.ps1 -Reset
```

`-Reset` elimina `cocos_orders_demo`, la vuelve a crear y carga `database.sql`. Se pierden las operaciones realizadas en esa base.

También puedes ejecutar el smoke desde la terminal con Newman.

```powershell
npx newman run delivery/postman/cocos-smoke.postman_collection.json -e delivery/postman/local.postman_environment.json
```

Para detener PostgreSQL, utiliza `docker compose stop postgres`. Vuelve a iniciarlo con `npm run db:up`. Si has pausado el contenedor en Docker Desktop, reanúdalo antes de enviar solicitudes.

## Endpoints

| Método y ruta                  | Qué devuelve                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| `GET /instruments`             | Instrumentos operables con búsqueda y paginación.                                             |
| `GET /users/:userId/portfolio` | Valor total de la cuenta, efectivo disponible y posiciones con cantidad, valor y rendimiento. |
| `POST /orders`                 | ID, estado y motivo de rechazo cuando corresponde.                                            |

### Instrumentos

`query` filtra por ticker o nombre y se combina con `page` y `pageSize`. Por ejemplo, `GET /instruments?query=galicia&page=1&pageSize=10`. Al omitir el filtro se consulta el catálogo completo de instrumentos operables. ARS representa efectivo y queda excluido.

La respuesta contiene `items` y `pagination`, con `page`, `pageSize`, `totalItems` y `totalPages`. El total cuenta las coincidencias antes de paginar. Los valores predeterminados son página 1 y tamaño 20, con un máximo de 100 por página. Una página fuera de rango devuelve `items: []` y conserva los totales. Un `query` vacío devuelve `400`.

### Órdenes

Este cuerpo solicita una compra MARKET de una acción de GGAL, instrumento 34 en los datos iniciales.

```json
{
  "userId": 1,
  "instrumentId": 34,
  "side": "BUY",
  "type": "MARKET",
  "quantity": 1
}
```

La solicitud admite `quantity` o `amount`. Los importes se envían como texto decimal, por ejemplo `"950.00"`. Para una LIMIT se requiere `price`. Una MARKET aceptada queda `FILLED` al último cierre. Una LIMIT aceptada queda `NEW` y reserva efectivo o acciones. Si los recursos son insuficientes, se registra como `REJECTED` con su motivo. Los tres estados responden `201` porque se creó el registro de la orden.

La cabecera opcional `Idempotency-Key` identifica una intención de compra o venta. Con el mismo usuario, clave y datos, el POST devuelve el resultado original. Reutilizar la clave con otros datos devuelve `409 IDEMPOTENCY_KEY_REUSED`. Al omitirla, cada POST se procesa como una solicitud independiente.

## Límites de espera de PostgreSQL

La API espera hasta 5 segundos para obtener una conexión, 5 para adquirir un bloqueo y 10 por sentencia en PostgreSQL. El cliente de Node deja de esperar la respuesta de una consulta a los 15 segundos, incluso si el servidor está pausado. Estos valores están en `src/database/database-timeouts.ts` y se aplican a cada operación de base de datos. Una petición puede ejecutar varias sentencias.

Los timeouts y las pérdidas de conexión devuelven `503 DATABASE_UNAVAILABLE` con `X-Request-Id`. Las transacciones se revierten cuando la conexión lo permite. Una conexión sin respuesta o cuyo rollback falla se descarta. Si se pierde la respuesta de `COMMIT`, la orden podría estar confirmada. Reintenta con la misma `Idempotency-Key` y el mismo cuerpo para recuperar el resultado. La API no reintenta escrituras automáticamente.

## Pruebas

`npm run test:check` ejecuta las pruebas unitarias. Las pruebas de integración y E2E requieren PostgreSQL y utilizan `TEST_DATABASE_URL`. Con la configuración documentada, inicia la base mediante `npm run db:up` y crea `cocos_test` una sola vez.

```powershell
docker compose exec -T postgres psql -U cocos -d cocos -v ON_ERROR_STOP=1 -c "CREATE DATABASE cocos_test;"
docker compose exec -T postgres psql -U cocos -d cocos_test -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/01-database.sql
```

Define la conexión y ejecuta todas las pruebas.

```powershell
$env:TEST_DATABASE_URL = 'postgresql://cocos:cocos@127.0.0.1:5432/cocos_test'
npm run test:all
```

También puedes guardar `TEST_DATABASE_URL` en `.env`. Las pruebas que acceden a PostgreSQL crean y eliminan datos, y esperan el esquema y los datos iniciales de `database.sql`. Utiliza una base dedicada. Si falta esa variable, se detienen antes de preparar datos. La conexión de la API que tengas en ejecución se mantiene independiente.

Puedes ejecutar las comprobaciones por separado.

| Comando                    | Qué comprueba                                   |
| -------------------------- | ----------------------------------------------- |
| `npm run test:db`          | Conexión y datos iniciales de PostgreSQL.       |
| `npm run test:integration` | Integración y rollback de las transacciones.    |
| `npm run test:e2e`         | Comportamiento de los endpoints con PostgreSQL. |
| `npm run lint`             | Reglas de calidad y tipos.                      |
| `npm run build`            | Compilación de la aplicación.                   |

La última ejecución completa pasó **160 pruebas en 19 archivos** con PostgreSQL temporal, además de las comprobaciones de lint y compilación.

## Actualizar una base local existente

Para una base creada antes de incorporar idempotencia, ejecuta el SQL de actualización. El ejemplo utiliza `cocos_test`. Para actualizar la base de desarrollo, sustituye `-d cocos_test` por `-d cocos`.

```powershell
Get-Content delivery/order-idempotency.sql -Raw | docker compose exec -T postgres psql -X -U cocos -d cocos_test -v ON_ERROR_STOP=1 -f -
```

La tabla `order_idempotency` se crea si todavía no existe. Las bases nuevas ya la incluyen en `database.sql`, y el script de demo aplica esta actualización al iniciarse.

## Documentación técnica

- Las [notas técnicas](delivery/tecnico.md) explican el modelo, el cálculo de cartera, las transacciones, la idempotencia y los timeouts.
- Los [diagramas técnicos en PDF](delivery/diagrams/Cocos_Diagramas_Tecnicos.pdf) muestran las relaciones del esquema y las secuencias de los endpoints, la concurrencia y la recuperación ante fallos de conexión.
