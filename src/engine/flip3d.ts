/**
 * WebGL card flipper. Large elements are never flipped with CSS 3D (perspective + zoom
 * would project them as screen-filling flats). Instead the card faces are canvases that
 * we upload as textures and rotate here with perspective-correct projection, lighting
 * falloff and a moving specular sheen.
 */
import gsap from 'gsap';

const VS = `
attribute vec2 aPos;
uniform vec2 uRes, uCenter, uSize;
uniform float uRotY, uRotX, uRotZ, uScale, uPersp;
varying vec2 vUv;
void main(){
  vec3 p = vec3(aPos * uSize * uScale, 0.0);
  float cz = cos(uRotZ), sz = sin(uRotZ);
  p.xy = vec2(p.x*cz - p.y*sz, p.x*sz + p.y*cz);
  float cy = cos(uRotY), sy = sin(uRotY);
  p = vec3(p.x*cy + p.z*sy, p.y, -p.x*sy + p.z*cy);
  float cx = cos(uRotX), sx = sin(uRotX);
  p = vec3(p.x, p.y*cx - p.z*sx, p.y*sx + p.z*cx);
  float q = (uPersp - p.z) / uPersp;          // homogeneous w → perspective-correct UVs
  vec2 s = uCenter + p.xy / q;
  vec2 clip = (s / uRes) * 2.0 - 1.0;
  gl_Position = vec4(clip.x * q, -clip.y * q, 0.0, q);
  vUv = aPos + 0.5;
}`;

const FS = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uFront, uBack;
uniform float uBackSide, uLight, uSheen;
void main(){
  vec2 uv = uBackSide > 0.5 ? vec2(1.0 - vUv.x, vUv.y) : vUv;
  vec4 c = uBackSide > 0.5 ? texture2D(uBack, uv) : texture2D(uFront, uv);
  float band = uv.x * 0.8 + uv.y * 0.4 - uSheen;
  float sheen = smoothstep(0.16, 0.0, abs(band)) * 0.45;
  c.rgb = c.rgb * uLight + vec3(sheen) * c.a;
  gl_FragColor = c;
}`;

interface FlipOpts {
  /** DOM element whose rect the card occupies (hidden during the flip) */
  el: HTMLElement;
  front: HTMLCanvasElement;
  back: HTMLCanvasElement;
  /** radians; 0 = front showing, PI = back showing */
  from: number;
  to: number;
  duration?: number;
  /** extra "hop" height in px */
  hop?: number;
  /** start scale (<1 = the card pops in while flipping) */
  enterScale?: number;
  onMid?: () => void;
}

class Flipper {
  private gl: WebGLRenderingContext | null = null;
  private cv!: HTMLCanvasElement;
  private prog!: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private texF!: WebGLTexture;
  private texB!: WebGLTexture;
  private dpr = 1;
  private active: null | {
    rect: DOMRect;
    s: { ry: number; rx: number; rz: number; sc: number; dy: number };
  } = null;
  supported = true;

  mount(cv: HTMLCanvasElement) {
    this.cv = cv;
    const gl = cv.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: true });
    if (!gl) {
      this.supported = false;
      return;
    }
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    gl.useProgram(p);
    this.prog = p;
    for (const n of ['uRes', 'uCenter', 'uSize', 'uRotY', 'uRotX', 'uRotZ', 'uScale', 'uPersp', 'uFront', 'uBack', 'uBackSide', 'uLight', 'uSheen'])
      this.u[n] = gl.getUniformLocation(p, n);

    // 16x10 grid so the vertex-level perspective looks smooth even at steep angles
    const verts: number[] = [];
    const GX = 16;
    const GY = 10;
    for (let y = 0; y < GY; y++)
      for (let x = 0; x < GX; x++) {
        const x0 = x / GX - 0.5, x1 = (x + 1) / GX - 0.5, y0 = y / GY - 0.5, y1 = (y + 1) / GY - 0.5;
        verts.push(x0, y0, x1, y0, x0, y1, x0, y1, x1, y0, x1, y1);
      }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.vertCount = verts.length / 2;

    this.texF = this.makeTex();
    this.texB = this.makeTex();
    gl.uniform1i(this.u.uFront, 0);
    gl.uniform1i(this.u.uBack, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    this.resize();
    addEventListener('resize', () => this.resize());
    cv.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.supported = false;
    });
  }
  private vertCount = 6;

  private makeTex() {
    const gl = this.gl!;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  resize() {
    if (!this.gl) return;
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.cv.width = innerWidth * this.dpr;
    this.cv.height = innerHeight * this.dpr;
    this.gl.viewport(0, 0, this.cv.width, this.cv.height);
  }

  /** Returns a promise resolved when the flip lands. Falls back to a 2D squash if no WebGL. */
  flip(o: FlipOpts): Promise<void> {
    const dur = o.duration ?? 0.7;
    if (!this.gl || !this.supported) return this.fallback(o, dur);
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texF);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, o.front);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texB);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, o.back);

    const rect = o.el.getBoundingClientRect();
    const s = { ry: o.from, rx: 0, rz: 0, sc: o.enterScale ?? 1, dy: 0 };
    this.active = { rect, s };
    o.el.style.visibility = 'hidden';
    const hop = o.hop ?? 40;
    let midFired = false;
    const midAngle = (o.from + o.to) / 2;

    return new Promise((resolve) => {
      gsap
        .timeline({
          onUpdate: () => {
            if (!midFired && (o.to > o.from ? s.ry >= midAngle : s.ry <= midAngle)) {
              midFired = true;
              o.onMid?.();
            }
          },
          onComplete: () => {
            this.active = null;
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            o.el.style.visibility = '';
            resolve();
          },
        })
        .to(s, { ry: o.to, duration: dur, ease: 'back.out(1.5)' }, 0)
        // lift: stretch up while rising, squash on landing
        .to(s, { sc: 1.14, dy: -hop, rx: -0.18, duration: dur * 0.38, ease: 'power2.out' }, 0)
        .to(s, { sc: 1, dy: 0, rx: 0, duration: dur * 0.62, ease: 'elastic.out(1, 0.55)' }, dur * 0.38)
        .fromTo(s, { rz: 0 }, { rz: 0.05, duration: dur * 0.3, yoyo: true, repeat: 1, ease: 'sine.inOut' }, 0);
    });
  }

  private fallback(o: FlipOpts, dur: number) {
    return new Promise<void>((resolve) => {
      gsap
        .timeline({ onComplete: () => resolve() })
        .to(o.el, { scaleX: 0, duration: dur * 0.35, ease: 'power2.in', onComplete: () => o.onMid?.() })
        .to(o.el, { scaleX: 1, duration: dur * 0.65, ease: 'elastic.out(1, 0.5)' });
    });
  }

  render() {
    const a = this.active;
    if (!a || !this.gl) return;
    const gl = this.gl;
    const { rect, s } = a;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniform2f(this.u.uRes, innerWidth, innerHeight);
    gl.uniform2f(this.u.uCenter, rect.left + rect.width / 2, rect.top + rect.height / 2 + s.dy);
    gl.uniform2f(this.u.uSize, rect.width, rect.height);
    gl.uniform1f(this.u.uRotY, s.ry);
    gl.uniform1f(this.u.uRotX, s.rx);
    gl.uniform1f(this.u.uRotZ, s.rz);
    gl.uniform1f(this.u.uScale, s.sc);
    gl.uniform1f(this.u.uPersp, 900);
    const facing = Math.cos(s.ry) * Math.cos(s.rx);
    gl.uniform1f(this.u.uBackSide, facing < 0 ? 1 : 0);
    gl.uniform1f(this.u.uLight, 0.55 + 0.45 * Math.abs(facing));
    // sheen sweeps across as the card turns
    gl.uniform1f(this.u.uSheen, ((s.ry / Math.PI) % 1) * 2.2 - 0.4);
    gl.drawArrays(gl.TRIANGLES, 0, this.vertCount);
  }
}

export const flipper = new Flipper();
