# The Fourth Satellite

**Live site: <https://squarejjj.github.io/fourth-satellite/>**

Your phone needs a fourth satellite because it doesn't know what time it is.

GPS satellites don't send your position. They send the time. Your phone times each signal's trip and turns it into a distance, but its quartz clock is far too poor for a signal that covers 300 km in a thousandth of a second. A clock just 1 ms out puts about 300 km on every distance. So the phone treats its own clock error as one more unknown: x, y, z and time make four unknowns, so it needs four satellites. This site is a working GPS receiver in the browser that shows that idea, then takes it apart in nine labs.

## What you can do with it

### The idea (home page, about two minutes)

A guided four-step puzzle on a flat slice through the Earth, drawn to scale:

1. **Time becomes distance.** Drag satellites or your phone; the circles of distance follow.
2. **A cheap clock.** Slide the phone's clock error. Every circle grows by the same amount. The crossing point moves hundreds of km, and nothing looks wrong. A dashed curve shows every place that fits two signals, one for each possible clock error.
3. **One more satellite.** A third circle no longer passes through the crossing: the mismatch gives the clock error away.
4. **Solve for the time too.** The receiver guesses, corrects and repeats from the centre of the Earth, and lands on your position and the exact clock error.

Below it are a measurement table (the receiver's view of each satellite) and a chart of position error against clock error, computed by running the receiver 81 times.

### The 3-D model

A rotatable globe with the GPS constellation (24 satellites in 6 orbits tilted 55°), 3-D satellite models, and the distance spheres. With 3 satellites and a wrong clock, an orange curve shows every position that fits. With 4, the spheres meet at one point and the solver finds you and the time.

### Nine labs

| Lab | What you do | What it shows |
|---|---|---|
| 1. Timing a signal | Slide a copy of a real GPS C/A code against a noisy signal | How travel time is measured, why a signal weaker than the noise can still be found, and CDMA |
| 2. Where the satellites are | Drag satellites on a sky plot; 300 fixes from the real solver | Dilution of precision, and why height is tangled with the clock |
| 3. The error budget | Switch error sources on and off | Errors add as a root-sum-square; the receiver clock dwarfs everything until the 4th satellite removes it |
| 4. The ionosphere | Change the time of day and the satellite's elevation; one or two frequencies | The Klobuchar model, the L1/L5 combination, and how a delay shared by all satellites goes into the clock unknown |
| 5. Lost in the city | Raise buildings, stand across the street | Blocked signals, echoes (always late), the cross-street error, a residual check, and multipath on the code |
| 6. Smoothing the jumps | Predict and correct, step by step | A Kalman filter on a walk, the lag-versus-jitter trade-off, and a tunnel |
| 7. Clocks in orbit | Change the orbit height and eccentricity | The −7 / +45 / +38 µs per day of relativity, and why a shared drift doesn't move your position |
| 8. Faking the signal | Jam or spoof a moving car | "No fresh position" versus "confidently wrong", and which check notices |
| 9. Under the hood | Watch the solver converge; drag beacons into a line | Quadratic convergence of Gauss–Newton, low orbits, and Bancroft's closed form with its ghost answer |

## How it works

The code is split the way a real receiver is:

- **`js/core/world.js` (the simulator)** knows the truth: where you are and how wrong your clock is. It turns that into the only thing a receiver gets: one pseudorange per satellite (distance + c × clock error + any extra delays).
- **`js/core/receiver.js` (the receiver)** sees only satellite positions and pseudoranges, never the truth. It solves with Gauss–Newton least squares: guess (the centre of the Earth), predict each pseudorange, replace each curved equation by its tangent, solve the small linear system, repeat. The clock is a column of ones in the matrix. If a full step makes the fit worse it takes half a step ("damped" Gauss–Newton), which keeps it converging from the Earth's centre even when satellites are bunched together. `receiver.js` does not import `world.js`; the tests check that.

Every page uses those two files. Everything else is either more of the physics (`js/core/`) or drawing (`js/ui/`, `js/pages/`).

### What is computed and what is drawn by hand

Every number, curve, dot and sphere is computed by our code from what you set, at the moment you set it. The solve animation interpolates between the receiver's actual guesses. Monte Carlo clouds use a seeded random generator, so the same noise is reused when you compare set-ups.

Drawn by hand: the satellite and phone icons, the stars in the space view, the window pattern on the city buildings, and the orbit speed in the 3-D model (one orbit in 90 s instead of 12 hours).

## What we simplified

- The Earth is a sphere (GPS uses the WGS84 ellipsoid), and satellites are placed by direction on a 26,560 km sphere rather than from broadcast orbit data.
- The home page uses a flat slice, which needs 3 satellites instead of 4; the 3-D model and the labs use full 3-D.
- Satellites hold still while the receiver solves, and the Earth's rotation during the signal's trip (the Sagnac effect) is left out.
- Error sizes are typical published values (mostly a 1995 report), not what any particular phone sees. The Klobuchar coefficients are sample values, not today's broadcast ones.
- The Kalman filter, the residual check and the spoofing checks are generic textbook versions, not what any particular phone runs.

## Where this falls short

- The receiver is handed satellite positions. A real one computes them from the broadcast orbit parameters (Kepler elements and corrections) and from the time of transmission; we only use Kepler's equation in the relativity lab.
- Timing (Lab 1) and positioning (everything else) are separate: the pseudoranges are not measured from the simulated code correlation. Joining the two would let you add noise to the signal and watch the position degrade.
- The city lab uses two infinite smooth walls, one echo per satellite, and no signal-strength model.
- There is no carrier phase, so RTK and centimetre positioning aren't covered.

## Checking our work

`tests/checks.js` holds 28 checks, which run in the browser at [`tests.html`](https://squarejjj.github.io/fourth-satellite/tests.html) and from the command line:

```bash
node tests/run.js
```

The command line adds one more check: the receiver doesn't import the simulator. The checks compare our code with published values (the GPS C/A code's first chips from IS-GPS-200, the Gold-code correlation values) and with the numbers in our research notes: the 1995 error budget (25.34 m and 8.13 m), the Klobuchar delays (4.255 m at 14:00, 1.500 m at night), the L1/L5 weights (2.2606, −1.2606, noise × 2.588), the multipath envelope (73 m peak, 440 m cut-off on L1; 7.3 m and 44 m on L5), the Kalman gains (0.132 / 0.360 / 0.661), the relativity rates (−7.21 / +45.72 / +38.50 µs per day), Bancroft's root (6,371.0 km, 149.896 km) and quadratic convergence. They also check properties: the solver converges on 500 random skies, DOP predicts the scatter of 2,000 simulated fixes, a delay shared by every satellite goes into the clock, and with 3 satellites the 3-D curve of possible positions passes through you at the true clock error.

## Running it

There is no build step and nothing to install. From the top of the repository:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/>. Browsers won't load JavaScript modules from a file opened directly, which is why it needs a server. The 3-D model needs an internet connection to fetch Three.js.

## The code

About 5,000 lines of plain JavaScript, plus the HTML and CSS. The maths uses no libraries.

| File | What's in it |
|---|---|
| `js/core/receiver.js` | The receiver: damped Gauss–Newton, residual check, curves of possible positions in 2-D and 3-D, circle and sphere intersections |
| `js/core/world.js` | The simulator: truth → pseudoranges |
| `js/core/bancroft.js` | Bancroft's closed-form solution |
| `js/core/dop.js` | Dilution of precision |
| `js/core/signal.js` | GPS C/A Gold-code generator and correlation |
| `js/core/iono.js` | Klobuchar model and the L1/L5 combination |
| `js/core/multipath.js` | Early–late tracking with one echo; the multipath envelope |
| `js/core/kalman.js` | Constant-velocity Kalman filter |
| `js/core/relativity.js` | Relativistic clock rates, Kepler's equation, the eccentricity term |
| `js/core/errors.js`, `geo.js`, `linalg.js`, `rng.js`, `constants.js` | Error budget, coordinates, small matrices, seeded random numbers, constants |
| `js/pages/*.js` | One file per page: controls and drawing |
| `js/ui/*.js` | Shared canvas, chart, sky-plot, theme and navigation helpers |
| `tests/` | The checks and the command-line runner |

## Things we didn't make ourselves

| What | Where it's used | Why |
|---|---|---|
| [Three.js](https://threejs.org) r160, loaded from the jsDelivr CDN | Drawing the 3-D model | WebGL by hand would be thousands of lines that teach nothing about GPS. Three.js only draws; positions and solutions come from our code. MIT licence. |
| Inter, Space Grotesk and JetBrains Mono from Google Fonts | Type | Clear, free fonts (SIL Open Font License). |

Parts of the code and text were drafted with an AI coding assistant (Claude, by Anthropic), working from the team's research notes.

## Sources

- IS-GPS-200 (GPS interface specification): C/A codes (3.3.2.3, Table 3-Ia), relativistic correction (20.3.3.3.3.1), constants.
- ESA Navipedia: Code Based Positioning; Bancroft Method; Positioning Error; Klobuchar Ionospheric Model; Ionospheric Delay; Ionosphere-free Combination; Multipath; Correlators; Kalman Filter; Relativistic Clock Correction.
- S. Bancroft (1985), "An Algebraic Solution of the GPS Equations", *IEEE Trans. AES* 21(1). Abel and Chaffee (1991) and Fang (1992), *IEEE Trans. AES*.
- National Research Council (1995), *The Global Positioning System: A Shared National Asset*, Tables 3-1 and 3-3.
- GPS.gov: GPS Accuracy; Selective Availability.
- N. Ashby (2003), "Relativity in the Global Positioning System", *Living Reviews in Relativity*; NIST, "Putting Einstein to the Test".
- Penn State GEOG 862: Dilution of Precision; The Ionospheric Effect.
- Ng, Zhang, Luo and Hsu (2021), *NAVIGATION* 68(4); Adjrad and Groves (2018), *Journal of Navigation* 71(1); Groves, Wang and Ziebart (2012), *GPS World*.
- L. Levy (1997), "The Kalman Filter: Navigation's Integration Workhorse".
- DHS, Resilient PNT; European GNSS Service Centre, OSNMA FAQ.

## Licence

MIT; see `LICENSE`.
