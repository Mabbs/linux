// SPDX-License-Identifier: MIT
export function assert(cond, message = "Assertation failed") {
    if (!cond)
        throw new Error(message);
}
export function unreachable(_, message = "Unreachable reached") {
    throw new Error(message);
}
