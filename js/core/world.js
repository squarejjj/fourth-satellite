// THE WORLD (the simulator)
// -------------------------
// This side knows the truth: where the receiver really is and how wrong its clock really is.
// Its only job is to turn that truth into what a receiver actually gets: one pseudorange per
// satellite it can hear. The receiver (receiver.js) never imports this file.

import { C } from './constants.js';
import { dist } from './linalg.js';

/**
 * Make the measurements a receiver would record.
 * @param {object} p
 * @param {number[]} p.truePos              where the receiver really is (m)
 * @param {number}   p.clockError           how far the receiver's clock is ahead, in seconds
 * @param {Array<{id, pos:number[], sys?:string}>} p.sats  satellites the receiver can hear
 * @param {object}   [p.extra]              extra metres added to each satellite's pseudorange
 *                                           (atmosphere, echoes, noise, spoofing …), keyed by id
 * @param {object}   [p.systemOffset]       extra seconds of clock offset per satellite system
 * @returns {Array<{id, sat, pr, sys}>}     frozen objects: the receiver cannot see anything else
 */
export function measure({ truePos, clockError = 0, sats, extra = {}, systemOffset = {} }) {
  return sats.map((s) => {
    const sys = s.sys ?? 'GPS';
    const geometric = dist(s.pos, truePos);
    // Arrival time on the receiver clock − send time = travel time + clock error.
    const pr = geometric + C * (clockError + (systemOffset[sys] ?? 0)) + (extra[s.id] ?? 0);
    return Object.freeze({ id: s.id, sat: Object.freeze([...s.pos]), pr, sys });
  });
}

// Travel time a signal really takes (simulator-only quantity, shown in tables for comparison).
export const travelTime = (satPos, truePos) => dist(satPos, truePos) / C;
