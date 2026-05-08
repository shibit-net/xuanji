declare module 'picomatch' {
  interface Options {
    dot?: boolean;
    nocase?: boolean;
    [key: string]: any;
  }

  function picomatch(pattern: string, options?: Options): (name: string) => boolean;

  export default picomatch;
}
