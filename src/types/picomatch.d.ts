declare module 'picomatch' {
  interface PicomatchOptions {
    dot?: boolean;
    nocase?: boolean;
    contains?: boolean;
    matchBase?: boolean;
  }

  type Matcher = (input: string) => boolean;

  interface Picomatch {
    (glob: string | string[], options?: PicomatchOptions): Matcher;
    isMatch(input: string, glob: string | string[], options?: PicomatchOptions): boolean;
  }

  const picomatch: Picomatch;
  export default picomatch;
}
