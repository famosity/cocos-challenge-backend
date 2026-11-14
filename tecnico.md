# Notas técnicas

El servicio es un proceso Nest. Los módulos son instrumentos, cartera, órdenes y base de datos. La primera ruta es `GET /instruments?query=`.

La base de la API es un PostgreSQL local. `DATABASE_URL` apunta ahí. Neon queda en `NEON_DATABASE_URL` y no se usa para escribir. Para levantar la base: `npm run db:up`. Docker crea el contenedor y carga `database.sql`, que trae el esquema y los datos de prueba. `npm run test:db` comprueba la conexión: hay 4 usuarios y filas en instrumentos, órdenes y cotizaciones. `npm run db:reset` borra el volumen y vuelve a cargar el archivo. El ejemplo de la URL local está en `.env.example`.

`GET /instruments?query=` busca el texto en el ticker o en el nombre, sin distinguir mayúsculas. "ggal" devuelve GGAL. "Galicia" también, porque está en el nombre. Si el ticker coincide entero, esa fila va primero. El resto se ordena por ticker y después por id. Si no hay coincidencias, la respuesta es `[]`. `%` y `_` se buscan como caracteres, no como comodines. Si `query` no viene, o queda vacío al quitar espacios, la respuesta es 400 con código `VALIDATION_ERROR` y el campo `query` en `details`.


Cada solicitud recibe un id. Sale en el header `X-Request-Id`. Si la respuesta es un error, el mismo id va en el cuerpo. Al terminar se escribe una línea JSON con el método, la ruta, el estado HTTP y la duración.

Un dato inválido responde 400, con código `VALIDATION_ERROR`. `details` nombra el campo. Para el texto "amount must be a positive number", el campo es `amount` y el mensaje es el resto.

Un fallo que no estaba previsto responde 500. El mensaje público es "Error interno" y lleva el `requestId`. La causa y el stack se escriben una sola vez, en un log de nivel error. No vuelven en el JSON.

Los errores conocidos usan `AppError`, con estado, código y mensaje. El filtro ya entiende `USER_NOT_FOUND` y `ZERO_ORDER_QUANTITY`. Hoy no hay ruta que los lance.

Los hooks se activan al clonar con `npm install`. El script `prepare` copia `.githooks` a `.git/hooks`. Después de cada commit corren los tests, y el commit queda aunque fallen. Antes de un push corren lint, tests y build, en ese orden. Si uno falla, el script sale con código distinto de cero y el push no sigue.
