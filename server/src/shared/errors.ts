export class AppError extends Error {
  status: number
  code: string
  fields?: Record<string, string>
  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message)
    this.status = status
    this.code = code
    if (fields) this.fields = fields
  }
}

export const badRequest = (msg: string, fields?: Record<string, string>) => new AppError(400, 'bad_request', msg, fields)
export const unauthorized = (msg = 'Debes iniciar sesión.') => new AppError(401, 'unauthorized', msg)
export const forbidden = (msg = 'No tienes permiso para realizar esta acción.') => new AppError(403, 'forbidden', msg)
export const notFound = (msg = 'No encontrado.') => new AppError(404, 'not_found', msg)
export const conflict = (code: string, msg: string) => new AppError(409, code, msg)
