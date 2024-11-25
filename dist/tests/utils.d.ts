declare function bench(name: string, count: number, test: (c: number) => any): void;
declare const Measurer: () => {
    add: (num: number) => void;
    sample: () => string;
};
declare function execShellCommand(cmd: string): Promise<unknown>;
export { bench, Measurer, execShellCommand };
