# The Fourth Satellite

**Live site: <https://squarejjj.github.io/fourth-satellite/>**

Why does your phone need four satellites to find you? Because it doesn't know what time it is.

GPS satellites don't send your position. They send the time. Your phone times each signal's trip and turns it into a distance, but its quartz clock is far too poor for a signal that covers 300 km in a thousandth of a second. So the phone treats its own clock error as one more unknown: x, y, z and time make four, so it needs four satellites. This site shows that idea in a 3-D model you scroll through, then lets you change the variables yourself.

## How to use it

1. **Generate World.** A small city builds itself around a car with its navigation on.
2. **Scroll.** Each step's text slides in, holds while you read, and slides away, while the 3-D model moves and zooms continuously with how far you have scrolled (11 steps, about two minutes):
   1. You're driving somewhere new; your phone's blue dot sits on your lane.
   2. Your phone only listens: it never transmits anything to GPS.
   3. The camera pulls back from the street to the whole Earth: the signals come from 20,200 km up.
   4. The constellation: 24 satellites in six orbits, so at least four are always above you.
   5. Each satellite broadcasts the time from its atomic clocks.
   6. Time becomes distance: a sphere grows out from the satellite until it reaches you.
   7. Three spheres meet at one point near the Earth: you, if your clock is perfect.
   8. A 1 ms clock error makes every distance 300 km too long; the meeting point slides hundreds of km along an orange line of places that fit equally well.
   9. A fourth satellite: the phone shifts its clock guess until all four spheres agree, and finds you and the clock error together.
   10. In the real world: several satellite systems, the ionosphere, reflections and relativity.
   11. Back to the car: all of this happens every second.
3. **Lab.** Every setting sits on one panel: how many satellites to use, the phone's clock error, a random error on each distance, the ionosphere's delay, where you stand, and whether to show the spheres or let the satellites move. You can also click satellites to use or drop them. The phone re-solves every frame, and four big numbers at the top of the panel give its answer: how far off it is (tinted green, amber or red), the clock error it found, how many satellites it used and how well spread they are (PDOP), with a sentence explaining what happened. A button takes you back to the explanation.

## How it works

The code is split the way a real receiver is:

- **`js/core/world.js` (the simulator)** knows the truth: where you are and how wrong your clock is. It turns that into the only thing a receiver gets: one pseudorange per satellite (distance + c × clock error + any extra delays).
- **`js/core/receiver.js` (the receiver)** sees only satellite positions and pseudoranges, never the truth. It solves with Gauss–Newton least squares: guess (the centre of the Earth), predict each pseudorange, replace each curved equation by its tangent, solve the small linear system, repeat. The clock is a column of ones in the matrix. If a full step makes the fit worse, it takes half a step, which keeps it converging from the Earth's centre even with bunched satellites. With exactly three satellites it also computes the curve of every position that fits (three-sphere intersection for each clock guess). `receiver.js` does not import `world.js`; a test checks that.

`js/scene.js` draws the Earth and the satellites with Three.js, and `js/city.js` draws the opening city scene (in metres, as its own scene, because a street and a planet are too different in size to share one). The two scenes hand over in a haze: both keep zooming out around your blue dot, the street fades into the sky's colour, the two canvases swap while the screen is all haze, and the Earth comes out of it (`js/veil.js`). `js/app.js` runs the page: one animation loop turns the scroll position into a single smoothed number (how many steps you are through the story) and both scenes draw themselves from it, which is why the model glides instead of jumping.

### What is computed and what is drawn by hand

Computed by our code from what you set: every satellite position and visibility (above 10°), every measurement, the phone's answer, the clock error it finds, the spheres, the lines where pairs of spheres meet, the orange curve, the numbers in the text and PDOP. In step 9 the phone's clock guess is shown sliding from 0 to the value the solver found, so you can watch the spheres shrink together; the end point is the solver's actual answer.

Drawn by hand: the city, the car and its route (scenery: no GPS is computed there), the satellite models, and the orbit speed when lab satellites move (one orbit in 90 seconds instead of about 12 hours).

## What we simplified

- The Earth is a sphere (GPS uses the WGS84 ellipsoid). The city is invented scenery.
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

Then open <http://localhost:8000/>. Browsers won't load JavaScript modules from a file opened directly, which is why it needs a server. The page needs an internet connection to fetch Three.js and the Earth imagery. Text uses your device's own sans-serif font (San Francisco on Apple devices, Segoe UI on Windows, Roboto on Android), so there is no font to download. Add `?still` to the address to make camera moves instant (handy for screenshots or slow devices).

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
| `js/scene.js` | The Earth, satellites, spheres and lab (drawing and interaction) |
| `js/city.js` | The opening city scene (scenery only) |
| `js/veil.js` | The sky-coloured haze the street fades into and the Earth comes out of |
| `js/app.js` | The page: home, scroll steps, lab controls |
| `tests/` | The checks and the command-line runner |

## Things we didn't make ourselves

| What | Where it's used | Why |
|---|---|---|
| [Three.js](https://threejs.org) r160, loaded from the jsDelivr CDN | Drawing the 3-D model | WebGL by hand would be thousands of lines that teach nothing about GPS. Three.js only draws; positions and solutions come from our code. MIT licence. |
| Earth imagery (colour, normal and cloud maps) from the three.js examples, loaded from jsDelivr | The Earth's surface | Real imagery reads instantly as "Earth"; we did not want to ship our own copy. |

Parts of the code and text were drafted with an AI coding assistant (Claude, by Anthropic), working from the team's research notes.

## Sources

- IS-GPS-200 (the GPS interface specification): constants, the relativistic correction.
- ESA Navipedia: "Code Based Positioning (SPS)", "Bancroft Method", "Positioning Error", "Klobuchar Ionospheric Model", "Ionosphere-free Combination".
- S. Bancroft (1985), "An Algebraic Solution of the GPS Equations", *IEEE Trans. Aerospace and Electronic Systems* 21(1).
- N. Ashby (2003), "Relativity in the Global Positioning System", *Living Reviews in Relativity*; NIST, "Putting Einstein to the Test".
- GPS.gov: "Space Segment" (constellation and orbits), "GPS Accuracy".

## Licence

MIT; see `LICENSE`.
