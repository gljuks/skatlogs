import { RenderParams } from './renderer';

/** Bipolar: MIDI 0-127 → -1.0 to 1.0 */
function bipolar(v: number): number {
  return (v - 63) / 63;
}

/** Unipolar: MIDI 0-127 → 0.0 to 1.0 */
function unipolar(v: number): number {
  return v / 127;
}

type MIDICallback = (params: RenderParams, value: number) => void;

/** CC mapping from original VIDEO_WAAAVES */
const ccMap: Record<number, MIDICallback> = {
  // Channel 1 HSB
  20: (p, v) => { p.channel1.hue = bipolar(v) * 5; },
  21: (p, v) => { p.channel1.sat = bipolar(v) * 5; },
  22: (p, v) => { p.channel1.bright = bipolar(v) * 5; },

  // Global effects
  24: (p, v) => { p.sharpen.amount = unipolar(v) * 2; },
  25: (p, v) => { p.blur.amount = unipolar(v); },

  // FB0 luma key / mix / delay
  28: (p, v) => { p.fb[0].lumakey = unipolar(v); },
  29: (p, v) => { p.fb[0].blend = (bipolar(v) + 1) * 0.5; }, // map -1..1 to 0..1
  30: (p, v) => { p.fb[0].delay = Math.max(1, Math.round(unipolar(v) * 29)); },

  // FB0 position / rotation
  4:  (p, v) => { p.fb[0].translate[0] = bipolar(v) * 0.5; },
  3:  (p, v) => { p.fb[0].translate[1] = bipolar(v) * 0.5; },
  12: (p, v) => { p.fb[0].translate[2] = 0.5 + unipolar(v) * 2; },
  11: (p, v) => { p.fb[0].rotate = bipolar(v) * Math.PI; },

  // FB0 color
  5:  (p, v) => { p.fb[0].hsb[0] = 1 + bipolar(v) * 2; },
  2:  (p, v) => { p.fb[0].hsb[1] = 1 + bipolar(v) * 2; },
  13: (p, v) => { p.fb[0].hsb[2] = 1 + bipolar(v) * 2; },

  // FB0 hue modulation
  16: (p, v) => { p.fb[0].huex[0] = unipolar(v) * 2; },
  10: (p, v) => { p.fb[0].huex[1] = bipolar(v) * 0.5 + 0.5; },
  17: (p, v) => { p.fb[0].huex[2] = bipolar(v); },

  // FB1 luma key / mix / delay
  31: (p, v) => { p.fb[1].lumakey = unipolar(v); },
  27: (p, v) => { p.fb[1].blend = (bipolar(v) + 1) * 0.5; },
  26: (p, v) => { p.fb[1].delay = Math.max(1, Math.round(unipolar(v) * 29)); },

  // FB1 position / rotation
  6:  (p, v) => { p.fb[1].translate[0] = bipolar(v) * 0.5; },
  1:  (p, v) => { p.fb[1].translate[1] = bipolar(v) * 0.5; },
  14: (p, v) => { p.fb[1].translate[2] = 0.5 + unipolar(v) * 2; },
  9:  (p, v) => { p.fb[1].rotate = bipolar(v) * Math.PI; },

  // FB1 color
  7:  (p, v) => { p.fb[1].hsb[0] = 1 + bipolar(v) * 2; },
  0:  (p, v) => { p.fb[1].hsb[1] = 1 + bipolar(v) * 2; },
  15: (p, v) => { p.fb[1].hsb[2] = 1 + bipolar(v) * 2; },

  // FB1 hue modulation
  18: (p, v) => { p.fb[1].huex[0] = unipolar(v) * 2; },
  8:  (p, v) => { p.fb[1].huex[1] = bipolar(v) * 0.5 + 0.5; },
  19: (p, v) => { p.fb[1].huex[2] = bipolar(v); },
};

let midiAccess: MIDIAccess | null = null;
let midiInputName = '';

export function getMidiInputName(): string {
  return midiInputName;
}

export async function initMIDI(params: RenderParams, onUpdate?: () => void): Promise<string[]> {
  if (!navigator.requestMIDIAccess) {
    console.warn('Web MIDI not supported');
    return [];
  }

  try {
    midiAccess = await navigator.requestMIDIAccess();
  } catch (e) {
    console.warn('MIDI access denied:', e);
    return [];
  }

  const inputNames: string[] = [];
  midiAccess.inputs.forEach((input) => {
    inputNames.push(input.name || input.id);
    input.onmidimessage = (msg: MIDIMessageEvent) => {
      const data = msg.data;
      if (!data || data.length < 3) return;

      const status = data[0] & 0xf0;
      // CC message
      if (status === 0xb0) {
        const cc = data[1];
        const value = data[2];
        const handler = ccMap[cc];
        if (handler) {
          handler(params, value);
          if (onUpdate) onUpdate();
        }
      }
    };
    midiInputName = input.name || input.id;
    console.log('MIDI input connected:', input.name);
  });

  // Listen for new connections
  midiAccess.onstatechange = (e: MIDIConnectionEvent) => {
    if (e.port && (e.port as MIDIPort).type === 'input' && (e.port as MIDIPort).state === 'connected') {
      const input = e.port as MIDIInput;
      input.onmidimessage = (msg: MIDIMessageEvent) => {
        const data = msg.data;
        if (!data || data.length < 3) return;
        const status = data[0] & 0xf0;
        if (status === 0xb0) {
          const handler = ccMap[data[1]];
          if (handler) {
            handler(params, data[2]);
            if (onUpdate) onUpdate();
          }
        }
      };
      midiInputName = input.name || input.id;
      console.log('MIDI input connected:', input.name);
    }
  };

  return inputNames;
}

// Type declarations for Web MIDI (not in default TS lib)
interface MIDIAccess {
  inputs: Map<string, MIDIInput>;
  outputs: Map<string, MIDIOutput>;
  onstatechange: ((e: MIDIConnectionEvent) => void) | null;
}
interface MIDIInput {
  id: string;
  name: string;
  type: string;
  state: string;
  onmidimessage: ((e: MIDIMessageEvent) => void) | null;
}
interface MIDIOutput { id: string; name: string; }
interface MIDIMessageEvent { data: Uint8Array; }
interface MIDIConnectionEvent { port: MIDIInput | MIDIOutput | null; }
declare global {
  interface Navigator { requestMIDIAccess(): Promise<MIDIAccess>; }
}
