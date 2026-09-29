/// <reference types="vite/client" />
declare module "*.jsonl?raw" {
  const text: string;
  export default text;
}
declare module "*.jsonl?url" {
  const url: string;
  export default url;
}
