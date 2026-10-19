/** Routes one initial viewport measurement while retaining the URL's search and fragment. */
export function redirectForInitialViewport(
  width: number,
  currentUrl: string,
  replace: (url: string) => void,
): void {
  const current = new URL(currentUrl, ['http:', '', 'agboard.local'].join('/'));
  const destination = width < 768 ? '/monitor/' : '/board/';
  replace(`${destination}${current.search}${current.hash}`);
}
