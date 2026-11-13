# Notas técnicas

El servicio es un proceso Nest. Los módulos son instrumentos, cartera, órdenes y base de datos. Ninguno publica rutas todavía. La base no se abre en este paso: el módulo está listo para conectar el pool cuando haya un PostgreSQL local.

TypeScript ya estaba en modo estricto.

Cada solicitud recibe un id. Sale en el header `X-Request-Id`. Si la respuesta es un error, el mismo id va en el cuerpo. Al terminar se escribe una línea JSON con el método, la ruta, el estado HTTP y la duración.

Un dato inválido responde 400, con código `VALIDATION_ERROR`. `details` nombra el campo. Para el texto "amount must be a positive number", el campo es `amount` y el mensaje es el resto.

Un fallo que no estaba previsto responde 500. El mensaje público es "Error interno" y lleva el `requestId`. La causa y el stack se escriben una sola vez, en un log de nivel error. No vuelven en el JSON.

Los errores conocidos usan `AppError`, con estado, código y mensaje. El filtro ya entiende `USER_NOT_FOUND` y `ZERO_ORDER_QUANTITY`. Hoy no hay ruta que los lance.

Los hooks se activan al clonar con `npm install`. El script `prepare` copia `.githooks` a `.git/hooks`. Después de cada commit corren los tests, y el commit queda aunque fallen. Antes de un push corren lint, tests y build, en ese orden. Si uno falla, el script sale con código distinto de cero y el push no sigue.
