/** An attachment resolver that gives no address, rather than failing, for an ID that is not one. */
export function attachmentResolver(urlOf: (id: string) => string): (id: string) => string | null {
  return (id) => {
    try {
      return urlOf(id);
    } catch {
      return null;
    }
  };
}
