type ParamValue = string | number | string[] | undefined

export function buildUrl(
  template: string,
  params: Record<string, string | number | string[]>,
): string {
  const qIndex = template.indexOf('?')
  if (qIndex === -1) {
    return replacePathParams(template, params)
  }

  const path = template.slice(0, qIndex)
  const queryString = template.slice(qIndex + 1)
  let url = replacePathParams(path, params)

  const parts = queryString.split('&').filter(part => {
    const m = part.match(/{([^}]+)}/)
    if (!m) return true
    const v = params[m[1]] as ParamValue
    return v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)
  })

  if (parts.length > 0) {
    const serialized = parts.map(part =>
      part.replace(/{([^}]+)}/g, (_, key) => {
        const v = params[key] as ParamValue
        if (Array.isArray(v)) {
          return v.map(item => `${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`).join('&')
        }
        return encodeURIComponent(String(v!))
      }),
    ).join('&')
    url += '?' + serialized
  }

  return url
}

function replacePathParams(
  template: string,
  params: Record<string, string | number | string[]>,
): string {
  return template.replace(/{([^}]+)}/g, (_match, key) => {
    const value = params[key]
    if (value === undefined) {
      throw new Error(`Missing required parameter "${key}" for URL: ${template}`)
    }
    return encodeURIComponent(String(value))
  })
}
