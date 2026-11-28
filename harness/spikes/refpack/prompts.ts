export const PERSON =
  'Margaret "Mags" Kowalczyk, a 58-year-old London bus mechanic. ' +
  'Broad-shouldered, weathered fair skin with laugh lines, cropped ' +
  'silver hair with one faded teal streak at the front, round ' +
  'tortoiseshell glasses, small silver hoop in her left ear. Outfit: ' +
  'faded navy work overalls with sleeves rolled to the elbow over a ' +
  'white t-shirt, a rust-orange knitted beanie pushed back on her ' +
  'head, scuffed oxblood leather boots.'

export const CAST_SHEET =
  `Character reference sheet of one fictional woman: ${PERSON} ` +
  'Four views of the SAME woman side by side on a plain light grey ' +
  'studio background, identical outfit in each: full body front ' +
  'view, full body three-quarter view, full body left profile, and ' +
  'a head-and-shoulders face close-up. Even soft studio light, ' +
  'photorealistic, natural skin texture, no text, no labels.'

const REFS =
  'Image 1 is a character reference sheet of one woman. Image 2 is ' +
  'the product, a Minor Figures Barista Oat 1 litre carton. Keep the ' +
  'woman identical to Image 1: same face, age, silver hair with the ' +
  'teal streak, round tortoiseshell glasses, navy overalls, ' +
  'rust-orange beanie. Keep the carton identical to Image 2: plain ' +
  'off-white carton, white screw cap, dark green "MINOR FIGURES ' +
  'BARISTA OAT" wordmark, line drawing of a person in a duck ' +
  'costume. Do not add any other text, captions or logos.'

const STYLE =
  'Photorealistic vertical 9:16 film still, 35mm, natural light, ' +
  'shallow depth of field.'

export const FRAMES: Record<string, string> = {
  F1:
    `${REFS} Scene: wide shot inside an East London bus depot at ` +
    'dawn. The woman slams shut the engine cover of a red ' +
    'double-decker bus, oil rag in one hand; the carton stands on ' +
    `a steel toolbox in the foreground. ${STYLE}`,
  F2:
    `${REFS} Scene: medium shot in a small cluttered home kitchen. ` +
    'Her oil-stained hands pour the carton into a mug of black ' +
    'coffee; the front of the carton faces the camera so "MINOR ' +
    'FIGURES BARISTA OAT" is sharp and readable. Her overalls ' +
    `are visible at frame edge. ${STYLE}`,
  F3:
    `${REFS} Scene: close-up on her face in the same kitchen as she ` +
    'takes the first sip from the mug, eyes closing, a slow broad ' +
    `grin starting, steam rising past her glasses. ${STYLE}`,
  F4:
    `${REFS} Scene: wide shot on a tower-block rooftop over East ` +
    'London at sunrise. She raises her mug to the skyline in a ' +
    'toast; the carton stands on the parapet beside her, front ' +
    `facing camera. ${STYLE}`,
}

export const MOTION: Record<string, string> = {
  F1:
    'Slow push-in. She slams the bus engine cover shut and tosses ' +
    'the rag over her shoulder. Keep her face and the carton ' +
    'unchanged.',
  F2:
    'Static close camera, slight handheld. She pours the oat milk ' +
    'into the coffee and it swirls; the carton text stays sharp ' +
    'and unchanged.',
  F3:
    'Slow dolly-in on her face. She sips, closes her eyes and ' +
    'breaks into a broad grin. Keep her face unchanged.',
  F4:
    'Slow crane up and back. She raises her mug to the skyline in ' +
    'a toast. The carton on the parapet stays unchanged.',
}

export const R2V_F1 =
  'Image 1 is the woman (a character sheet). Image 2 is the product ' +
  'carton. Wide shot inside an East London bus depot at dawn: the ' +
  'woman from Image 1 slams shut the engine cover of a red ' +
  'double-decker bus and tosses an oil rag over her shoulder; the ' +
  'carton from Image 2 stands on a steel toolbox in the foreground. ' +
  'Slow push-in. Keep her face, outfit and the carton exactly as ' +
  'in the references. Photorealistic, no text overlays.'

export const FIX_SUFFIX =
  ' Product text check: the carton has exactly ONE white screw cap. ' +
  'Its wordmark reads, letter for letter, "MINOR FIGURES" on the ' +
  'first line and "BARISTA OAT" on the second, left-aligned, never ' +
  'mirrored, copied exactly from Image 2. Make the carton large ' +
  'enough in frame that the wordmark is crisp.'
