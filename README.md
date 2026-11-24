# The Fourth Satellite

**Live site: <https://squarejjj.github.io/fourth-satellite/>**

Why does your phone need four satellites to find you? Because it doesn't know what time it is.

GPS satellites don't send your position. They send the time. Your phone times each signal's trip and turns it into a distance, but its quartz clock is far too poor for a signal that covers 300 km in a thousandth of a second. So the phone treats its own clock error as one more unknown: x, y, z and time make four, so it needs four satellites. This site shows that idea in a 3-D model you scroll through, then lets you change the variables yourself.

## How to use it

1. **Generate World.** A blocky, Earth-sized world builds itself (a new random one each time).
2. **Scroll.** The model stays in the middle of the screen and changes as you read eight short steps (about two minutes):
   1. A world the size of Earth, and you on it.
   2. 24 GPS satellites in six tilted orbits, 20,200 km up.
   3. Each one broadcasts the time.
   4. Time becomes distance: one signal puts you on a sphere around its satellite.
   5. Three spheres meet at one point: you, if your clock is perfect.
   6. A 1 ms clock error makes every distance 300 km too long. Scrolling slides the meeting point hundreds of km away along an orange line: every place that fits three signals, one for each possible clock error.
   7. A fourth satellite. As you scroll, the phone shifts its clock guess until all four spheres meet, and it finds you and the clock error together.
   8. Why real phones use many more satellites, and a note on relativity.
3. **Lab.** Change the number of satellites (3–8), the phone's clock error, random measurement noise, the delay from the air (ionosphere), and where you stand. Turn the world with the mouse. The phone re-solves every time and shows how far off it is, the clock error it found, and how well spread the satellites are (PDOP).

## How it works

The code is split the way a real receiver is:

- **`js/core/world.js` (the simulator)** knows the truth: where you are and how wrong your clock is. It turns that into the only thing a receiver gets: one pseudorange per satellite (distance + c × clock error + any extra delays).
- **`js/core/receiver.js` (the receiver)** sees only satellite positions and pseudoranges, never the truth. It solves with Gauss–Newton least squares: guess (the centre of the Earth), predict each pseudorange, replace each curved equation by its tangent, solve the small linear system, repeat. The clock is a column of ones in the matrix. If a full step makes the fit worse, it takes half a step, which keeps it converging from the Earth's centre even with bunched satellites. With exactly three satellites it also computes the curve of every position that fits (three-sphere intersection for each clock guess). `receiver.js` does not import `world.js`; a test checks that.

`js/scene.js` draws the result with Three.js: the generated world, the orbits, the satellite models, the distance spheres, the lines where pairs of spheres meet, the orange curve and the phone's answer. `js/app.js` runs the page: the home screen, the scroll steps and the lab panel.

### What is computed and what is drawn by hand

Computed by our code from what you set: every satellite position and visibility (above 10°), every measurement, the phone's answer, the clock error it finds, the spheres, the lines where they meet, the orange curve, the numbers in the text and PDOP. In step 7 the phone's clock guess is shown sliding from 0 to the value the solver found, so you can watch the spheres shrink together; the end point is the solver's actual answer.

Drawn by hand: the land and sea of the generated world (random noise, not real geography), the satellite models, and the orbit speed (one orbit takes 60 seconds instead of about 12 hours).

## What we simplified

- The Earth is a sphere (GPS uses the WGS84 ellipsoid), and the world's geography is made up.
- The 24 satellites sit in six evenly spaced circular orbits; real orbits are slightly elliptical and spaced less evenly. The Earth's spin isn't shown.
- Satellites hold still while the receiver solves, and satellite clocks are perfect.
- In the lab, noise is independent on each satellite, and the air delay is a fixed delay straight up, stretched by the Klobuchar slant factor for lower satellites.

## Where this falls short

- The receiver is handed satellite positions. A real one computes them from the orbit data each satellite broadcasts.
- The travel times are computed, not measured from a simulated radio signal, so you can't see how a receiver lines up the satellite's code.
- Signal echoes off buildings, smoothing over time (Kalman filtering) and spoofing are mentioned but not modelled.

## Checking our work

`tests/checks.js` holds the checks. They run in the browser on the [self-test page](https://squarejjj.github.io/fourth-satellite/tests.html) and from the command line:

```bash
node tests/run.js
```

They check the solver against exact answers and published numbers: it converges from the Earth's centre on 500 random skies; convergence is quadratic; Bancroft's closed-form method finds the same position and clock (6,371.0 km, 149.896 km for a 0.5 ms clock error); a delay shared by every satellite goes into the clock, not the position; with three satellites the 3-D curve of possible positions passes through you at the true clock error; DOP predicts the scatter of 2,000 noisy fixes; the Klobuchar ionosphere model and the L1/L5 combination match our research notes' values; and the relativity numbers (−7.21 / +45.72 / +38.50 µs per day) that the story quotes. The command line adds one more: the receiver doesn't import the simulator.

## Running it

There is no build step and nothing to install. From the top of the repository:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/>. Browsers won't load JavaScript modules from a file opened directly, which is why it needs a server. The page needs an internet connection to fetch Three.js and the font. Add `?still` to the address to make camera moves instant (handy for screenshots or slow devices).

## The code

| File | What's in it |
|---|---|
| `js/core/receiver.js` | The receiver: damped Gauss–Newton, residual check, three-sphere intersection and the curve of possible positions |
| `js/core/world.js` | The simulator: truth → pseudoranges |
| `js/core/dop.js` | Dilution of precision (PDOP) |
| `js/core/iono.js` | The ionosphere's slant factor and the Klobuchar model |
| `js/core/bancroft.js` | Bancroft's closed-form solution, used by the tests as an independent check |
| `js/core/relativity.js` | Relativistic clock rates (the 38 µs per day in the story) |
| `js/core/geo.js`, `linalg.js`, `rng.js`, `constants.js` | Coordinates, small matrices, seeded random numbers, constants |
| `js/scene.js` | The 3-D world (drawing only) |
| `js/app.js` | The page: home, scroll steps, lab |
| `tests/` | The checks and the command-line runner |

## Things we didn't make ourselves

| What | Where it's used | Why |
|---|---|---|
| [Three.js](https://threejs.org) r160, loaded from the jsDelivr CDN | Drawing the 3-D model | WebGL by hand would be thousands of lines that teach nothing about GPS. Three.js only draws; positions and solutions come from our code. MIT licence. |
| Pixelify Sans, from Google Fonts | All text | A readable pixel font for the blocky look (SIL Open Font License). |

Parts of the code and text were drafted with an AI coding assistant (Claude, by Anthropic), working from the team's research notes.

## Sources

- IS-GPS-200 (the GPS interface specification): constants, the relativistic correction.
- ESA Navipedia: "Code Based Positioning (SPS)", "Bancroft Method", "Positioning Error", "Klobuchar Ionospheric Model", "Ionosphere-free Combination".
- S. Bancroft (1985), "An Algebraic Solution of the GPS Equations", *IEEE Trans. Aerospace and Electronic Systems* 21(1).
- N. Ashby (2003), "Relativity in the Global Positioning System", *Living Reviews in Relativity*; NIST, "Putting Einstein to the Test".
- GPS.gov: "Space Segment" (constellation and orbits), "GPS Accuracy".

## Licence

MIT; see `LICENSE`.
