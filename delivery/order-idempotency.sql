CREATE TABLE IF NOT EXISTS order_idempotency (
  userId INT NOT NULL,
  key VARCHAR(128) NOT NULL,
  orderId INT NOT NULL,
  request JSONB NOT NULL,
  response JSONB NOT NULL,
  PRIMARY KEY (userId, key),
  FOREIGN KEY (userId) REFERENCES users(id),
  FOREIGN KEY (orderId) REFERENCES orders(id)
);
