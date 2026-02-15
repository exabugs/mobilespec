/* ================================
 * Helpers
 * ================================ */

export function screenKey(id: string, context?: string): string {
  return context ? `${id}__${context}` : id;
}

export function displayId(id: string, context?: string): string {
  return context ? `${id}[${context}]` : id;
}
