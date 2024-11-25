"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.execShellCommand = exports.Measurer = exports.bench = void 0;
function bench(name, count, test) {
    const start = process.hrtime.bigint();
    const result = test(count);
    const total = process.hrtime.bigint() - start;
    console.log(`${name}
    ns/itr: ${total / BigInt(count)}
    result:`, result);
}
exports.bench = bench;
const Measurer = () => {
    let lastTime = Date.now();
    let totalCount = 0;
    const add = (num) => {
        totalCount += num;
    };
    const sample = () => {
        const currentTime = Date.now();
        const timeDiff = currentTime - lastTime;
        const result = (totalCount / timeDiff) * 1000;
        lastTime = currentTime;
        totalCount = 0;
        return `${Math.round(result)}/s`;
    };
    return {
        add,
        sample,
    };
};
exports.Measurer = Measurer;
function execShellCommand(cmd) {
    const exec = require('child_process').exec;
    return new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                console.warn(error);
            }
            resolve(stdout ? stdout : stderr);
        });
    });
}
exports.execShellCommand = execShellCommand;
//# sourceMappingURL=utils.js.map