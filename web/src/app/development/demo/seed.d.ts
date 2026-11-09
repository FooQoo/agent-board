// The sample data of the demo build, which `web/demo-build.ts` reads from `web/test/fixtures/`.
declare module 'virtual:agboard-demo-seed' {
  export const fixture: import('@/shared/api/contracts').Board;
  export const longMarkdown: string;
}
