import type { SoundLevels } from '../types';

type Layer = Exclude<keyof SoundLevels, 'master'>;

/**
 * Nagrania z Wikimedia Commons (źródła i licencje: public/sounds/CREDITS.txt).
 * Pętle mają wyciszone końce — gramy dwie kopie przesunięte o pół długości, więc szew nie jest słyszalny.
 */
const LOOPS: Partial<Record<Layer, string>> = {
  rain: 'rain.mp3',
  storm: 'storm.mp3',
  wind: 'wind.mp3',
  snow: 'snow.mp3',
  animals: 'birds.mp3',
  crickets: 'crickets.mp3',
};
const THUNDER = ['thunder-1.mp3', 'thunder-2.mp3', 'thunder-3.mp3', 'thunder-4.mp3', 'thunder-5.mp3'];
const OWL = 'owl.mp3';

interface LayerNodes {
  out: GainNode; // głośność z suwaka
  synth: GainNode; // warstwa syntetyczna: gra do czasu wczytania nagrania (i gdy nagrania brak)
  sample: GainNode; // nagranie
  state: 'synth' | 'loading' | 'sample' | 'failed';
}

/**
 * Dźwięki otoczenia. Nagrania są dociągane leniwie, dopiero gdy użytkownik podniesie suwak;
 * do tego czasu (albo bez sieci) warstwa jest syntetyzowana w Web Audio z szumu i oscylatorów.
 * Jedna instancja na scenę.
 */
export class Soundscape {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muffle: BiquadFilterNode | null = null;
  private layers = new Map<Layer, LayerNodes>();
  private noise: AudioBuffer | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private thunderReady: AudioBuffer[] = [];
  private owlReady: AudioBuffer | null = null;
  private levels: SoundLevels = { master: 0.8, rain: 0, storm: 0, snow: 0, wind: 0, animals: 0, crickets: 0 };
  private night = false;
  private indoors = false;
  private disposed = false;
  private nextBird = 2;
  private nextRumble = 8;

  private readonly onGesture = () => {
    this.ensureContext();
  };

  constructor() {
    // przeglądarka pozwala uruchomić dźwięk dopiero po geście użytkownika
    window.addEventListener('pointerdown', this.onGesture, true);
    window.addEventListener('keydown', this.onGesture, true);
  }

  setLevels(levels: SoundLevels) {
    this.levels = levels;
    if (this.anyAudible()) this.ensureContext();
    this.applyLevels();
  }

  /** Noc uruchamia świerszcze i sowę zamiast ptaków; wnętrze tłumi wszystko jak zamknięte okno. */
  setEnvironment(night: boolean, indoors: boolean) {
    this.night = night;
    this.indoors = indoors;
    this.applyLevels();
  }

  /** Grzmot zsynchronizowany z błyskawicą z WeatherSystem. */
  thunder() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.levels.storm <= 0) return;
    const layer = this.layers.get('storm');
    if (!layer) return;
    const delay = 0.15 + Math.random() * 0.6;
    if (this.thunderReady.length > 0) {
      const buf = this.thunderReady[Math.floor(Math.random() * this.thunderReady.length)];
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = 0.7 + Math.random() * 0.3;
      src.connect(g).connect(layer.out);
      src.start(ctx.currentTime + delay);
      return;
    }
    if (!this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.5 + Math.random() * 0.2;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 140;
    lp.Q.value = 1.2;
    const g = ctx.createGain();
    const t0 = ctx.currentTime + delay;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(2.2, t0 + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 3.5 + Math.random() * 2);
    src.connect(lp).connect(g).connect(layer.out);
    src.start(t0);
    src.stop(t0 + 6.5);
  }

  update(dt: number) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const animals = this.layers.get('animals');
    if (animals && this.levels.animals > 0 && !this.indoors) {
      this.nextBird -= dt;
      if (this.nextBird <= 0) {
        if (this.night) this.owl();
        else if (animals.state !== 'sample') this.birdChirp();
        this.nextBird = this.night ? 6 + Math.random() * 10 : 1.2 + Math.random() * 3.5;
      }
    }
    // oddalone pomruki burzy niezależnie od błyskawic
    if (this.levels.storm > 0) {
      this.nextRumble -= dt;
      if (this.nextRumble <= 0) {
        this.thunder();
        this.nextRumble = 9 + Math.random() * 14;
      }
    }
  }

  dispose() {
    this.disposed = true;
    window.removeEventListener('pointerdown', this.onGesture, true);
    window.removeEventListener('keydown', this.onGesture, true);
    this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.layers.clear();
    this.buffers.clear();
    this.thunderReady = [];
    this.owlReady = null;
  }

  private anyAudible() {
    const l = this.levels;
    return l.master > 0 && (l.rain > 0 || l.storm > 0 || l.snow > 0 || l.wind > 0 || l.animals > 0 || l.crickets > 0);
  }

  private ensureContext() {
    if (this.disposed) return;
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => undefined);
      return;
    }
    if (!this.anyAudible()) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.noise = makeNoise(ctx);
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.muffle.connect(this.master).connect(ctx.destination);
    this.buildLayers();
    this.applyLevels();
    if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
  }

  private layer(name: Layer): LayerNodes {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.muffle!);
    const synth = ctx.createGain();
    synth.gain.value = 1;
    synth.connect(out);
    const sample = ctx.createGain();
    sample.gain.value = 0;
    sample.connect(out);
    const nodes: LayerNodes = { out, synth, sample, state: 'synth' };
    this.layers.set(name, nodes);
    return nodes;
  }

  private noiseSource(rate = 1): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = rate;
    src.start();
    return src;
  }

  // ---------- nagrania ----------

  private load(name: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(name);
    if (p) return p;
    p = fetch(`${import.meta.env.BASE_URL}sounds/${name}`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))))
      .then((data) => (this.ctx && !this.disposed ? this.ctx.decodeAudioData(data) : null))
      .catch(() => null);
    this.buffers.set(name, p);
    return p;
  }

  /** Dociąga nagranie warstwy i podmienia syntezę na pętlę z pliku. */
  private loadLayer(name: Layer) {
    const nodes = this.layers.get(name);
    const file = LOOPS[name];
    if (!nodes || !file || nodes.state !== 'synth') return;
    nodes.state = 'loading';
    this.load(file).then((buf) => {
      const ctx = this.ctx;
      if (!ctx || this.disposed || this.layers.get(name) !== nodes) return;
      if (!buf) {
        nodes.state = 'failed';
        return;
      }
      for (const offset of [0, buf.duration / 2]) {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        src.connect(nodes.sample);
        src.start(0, offset);
      }
      nodes.state = 'sample';
      const now = ctx.currentTime;
      nodes.sample.gain.setValueAtTime(0, now);
      nodes.sample.gain.linearRampToValueAtTime(1, now + 1.5);
      nodes.synth.gain.setValueAtTime(nodes.synth.gain.value, now);
      nodes.synth.gain.linearRampToValueAtTime(0, now + 1.5);
    });
  }

  private loadThunder() {
    if (this.buffers.has(THUNDER[0])) return;
    for (const f of THUNDER) {
      this.load(f).then((buf) => {
        if (buf && !this.disposed) this.thunderReady.push(buf);
      });
    }
  }

  private loadOwl() {
    if (this.buffers.has(OWL)) return;
    this.load(OWL).then((buf) => {
      if (buf && !this.disposed) this.owlReady = buf;
    });
  }

  // ---------- synteza ----------

  private buildLayers() {
    const ctx = this.ctx!;

    // deszcz: szum przepuszczony przez pasmo średnie, z lekkim "kapaniem" na wyższych częstotliwościach
    const rain = this.layer('rain').synth;
    const rainBp = ctx.createBiquadFilter();
    rainBp.type = 'bandpass';
    rainBp.frequency.value = 2400;
    rainBp.Q.value = 0.5;
    this.noiseSource().connect(rainBp).connect(rain);
    const drip = ctx.createBiquadFilter();
    drip.type = 'highpass';
    drip.frequency.value = 6000;
    const dripGain = ctx.createGain();
    dripGain.gain.value = 0.25;
    this.noiseSource(1.3).connect(drip).connect(dripGain).connect(rain);

    // burza: ulewa ciemniejsza od zwykłego deszczu; grzmoty dokładane w thunder()
    const storm = this.layer('storm').synth;
    const stormLp = ctx.createBiquadFilter();
    stormLp.type = 'lowpass';
    stormLp.frequency.value = 1600;
    const stormGain = ctx.createGain();
    stormGain.gain.value = 0.9;
    this.noiseSource(0.9).connect(stormLp).connect(stormGain).connect(storm);

    // wiatr: szum niskopasmowy, którego częstotliwość powoli faluje
    const wind = this.layer('wind').synth;
    const windBp = ctx.createBiquadFilter();
    windBp.type = 'bandpass';
    windBp.frequency.value = 380;
    windBp.Q.value = 0.9;
    const windGain = ctx.createGain();
    windGain.gain.value = 1.6;
    this.noiseSource(0.6).connect(windBp).connect(windGain).connect(wind);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 220;
    lfo.connect(lfoDepth).connect(windBp.frequency);
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.23;
    const lfo2Depth = ctx.createGain();
    lfo2Depth.gain.value = 0.35;
    lfo2.connect(lfo2Depth).connect(windGain.gain);
    lfo.start();
    lfo2.start();

    // śnieg: bardzo cichy, miękki szept powietrza
    const snow = this.layer('snow').synth;
    const snowLp = ctx.createBiquadFilter();
    snowLp.type = 'lowpass';
    snowLp.frequency.value = 700;
    const snowHp = ctx.createBiquadFilter();
    snowHp.type = 'highpass';
    snowHp.frequency.value = 150;
    const snowGain = ctx.createGain();
    snowGain.gain.value = 0.9;
    this.noiseSource(0.45).connect(snowLp).connect(snowHp).connect(snowGain).connect(snow);
    const snowLfo = ctx.createOscillator();
    snowLfo.frequency.value = 0.05;
    const snowDepth = ctx.createGain();
    snowDepth.gain.value = 0.4;
    snowLfo.connect(snowDepth).connect(snowGain.gain);
    snowLfo.start();

    // zwierzęta: ćwierkanie i sowa są generowane na bieżąco w update()
    this.layer('animals');

    // świerszcze: wysoki ton przerywany szybkim tremolo, dwa "osobniki" w różnym tempie
    const crickets = this.layer('crickets').synth;
    for (const [freq, rate, vol] of [
      [4300, 28, 0.06],
      [5100, 22, 0.045],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq;
      const trem = ctx.createOscillator();
      trem.type = 'square';
      trem.frequency.value = rate;
      const tremGain = ctx.createGain();
      tremGain.gain.value = 0.5;
      const bias = ctx.createConstantSource();
      bias.offset.value = 0.5;
      const amp = ctx.createGain();
      amp.gain.value = 0;
      trem.connect(tremGain).connect(amp.gain);
      bias.connect(amp.gain);
      // cykl: kilka sekund grania, chwila przerwy
      const burst = ctx.createOscillator();
      burst.type = 'square';
      burst.frequency.value = 0.18 + Math.random() * 0.08;
      const burstGain = ctx.createGain();
      burstGain.gain.value = 0.5;
      const burstBias = ctx.createConstantSource();
      burstBias.offset.value = 0.5;
      const gate = ctx.createGain();
      gate.gain.value = 0;
      burst.connect(burstGain).connect(gate.gain);
      burstBias.connect(gate.gain);
      const out = ctx.createGain();
      out.gain.value = vol;
      osc.connect(amp).connect(gate).connect(out).connect(crickets);
      osc.start();
      trem.start();
      bias.start();
      burst.start();
      burstBias.start();
    }
  }

  private applyLevels() {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.muffle) return;
    const now = ctx.currentTime;
    const ramp = (param: AudioParam, v: number, time = 0.25) => {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(v, now + time);
    };
    ramp(this.master.gain, this.levels.master * (this.indoors ? 0.35 : 1));
    ramp(this.muffle.frequency, this.indoors ? 900 : 20000, 0.5);
    for (const [name, nodes] of this.layers) {
      let v = this.levels[name];
      // świerszcze w dzień prawie milkną, tak jak w naturze
      if (name === 'crickets' && !this.night) v *= 0.3;
      ramp(nodes.out.gain, v);
      if (v > 0) this.loadLayer(name);
    }
    if (this.levels.storm > 0) this.loadThunder();
    if (this.levels.animals > 0 && this.night) this.loadOwl();
  }

  private birdChirp() {
    const ctx = this.ctx!;
    const out = this.layers.get('animals')!.synth;
    const base = 2200 + Math.random() * 1600;
    const notes = 2 + Math.floor(Math.random() * 4);
    let t = ctx.currentTime + 0.05;
    for (let i = 0; i < notes; i++) {
      const osc = ctx.createOscillator();
      const f0 = base * (0.9 + Math.random() * 0.25);
      const f1 = f0 * (Math.random() < 0.5 ? 1.35 : 0.72);
      const dur = 0.07 + Math.random() * 0.08;
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      // losowe położenie w panoramie, żeby ptaki nie siedziały w jednym punkcie
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.random() * 1.6 - 0.8;
      osc.connect(g).connect(pan).connect(out);
      osc.start(t);
      osc.stop(t + dur + 0.02);
      t += dur + 0.04 + Math.random() * 0.1;
    }
  }

  private owl() {
    const ctx = this.ctx!;
    const layer = this.layers.get('animals')!;
    if (this.owlReady) {
      const src = ctx.createBufferSource();
      src.buffer = this.owlReady;
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.random() * 1.2 - 0.6;
      const g = ctx.createGain();
      g.gain.value = 0.5 + Math.random() * 0.3;
      src.connect(g).connect(pan).connect(layer.out);
      src.start();
      return;
    }
    const out = layer.synth;
    let t = ctx.currentTime + 0.05;
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(i === 0 ? 380 : 340, t);
      osc.frequency.exponentialRampToValueAtTime(i === 0 ? 330 : 290, t + 0.35);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.06);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      osc.connect(lp).connect(g).connect(out);
      osc.start(t);
      osc.stop(t + 0.45);
      t += i === 0 ? 0.32 : 0.5;
    }
  }
}

/** Dwie sekundy białego szumu — źródło syntetycznych warstw pogodowych. */
function makeNoise(ctx: AudioContext): AudioBuffer {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return buf;
}
