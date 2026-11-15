export type FieldError = {
  field: string;
  message: string;
};

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: FieldError[],
  ) {
    super(message);
  }
}

export function validationError(field: string, message: string): AppError {
  return new AppError(400, 'VALIDATION_ERROR', 'La solicitud es inválida', [{ field, message }]);
}

export function userNotFound(): AppError {
  return new AppError(404, 'USER_NOT_FOUND', 'El usuario no existe');
}
