import axios, { AxiosError } from 'axios'

/** Versión de la API que consume el frontend. Un cambio incompatible del backend publicaría /api/v2. */
export const API_BASE = '/api/v1'

export const http = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
  timeout: 20_000,
})

type ErrorBody = { error?: { code?: string; message?: string; fields?: Record<string, string> } }

/** Error normalizado de la API: mensaje legible, código y errores por campo. */
export class ApiError extends Error {
  status: number
  code: string
  fields: Record<string, string>
  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}) {
    super(message)
    this.status = status
    this.code = code
    this.fields = fields
  }
}

http.interceptors.response.use(
  (res) => res,
  (error: unknown) => {
    if (error instanceof AxiosError) {
      if (error.response) {
        const e = (error.response.data as ErrorBody | undefined)?.error
        return Promise.reject(
          new ApiError(
            error.response.status,
            e?.code ?? 'error',
            e?.message ?? 'Ha ocurrido un error inesperado.',
            e?.fields
          )
        )
      }
      const offline = error.code === 'ECONNABORTED' ? 'La conexión ha tardado demasiado.' : 'No se puede conectar con el servidor. Revisa tu conexión.'
      return Promise.reject(new ApiError(0, 'network', offline))
    }
    return Promise.reject(error)
  }
)

export const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : 'Ha ocurrido un error inesperado.'

export async function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return (await http.get<T>(url, { params })).data
}
export async function post<T>(url: string, data?: unknown): Promise<T> {
  return (await http.post<T>(url, data ?? {})).data
}
export async function put<T>(url: string, data: unknown): Promise<T> {
  return (await http.put<T>(url, data)).data
}
export async function patch<T>(url: string, data: unknown): Promise<T> {
  return (await http.patch<T>(url, data)).data
}
export async function del<T>(url: string): Promise<T> {
  return (await http.delete<T>(url)).data
}
