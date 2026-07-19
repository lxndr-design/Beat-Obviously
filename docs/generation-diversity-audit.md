# Generation Diversity Audit

Mode: local fallback/procedural layer
Runs per category: 20

Goal: measure divergence. Higher uniqueness and distance are better when the user repeatedly asks for a generated idea. This audit values dynamic range over strict convergence.

## Instrument Generation

### synth

- Prompt: novel dynamic synth patch, not a preset, surprising macro identity
- Unique fingerprints: 20
- Numeric pairwise distance: 0.208
- Categorical pairwise distance: 0.692
- Schema coverage: `{"total":20,"targetKindMatches":20,"aetherEligible":20,"aetherStackComplete":20,"canonicalSynthPatch":20,"finiteCoreValues":20}`
- Kinds: `{"wavetable":20}`
- Waveforms: `{"wavetable":20}`
- Samples: `{"none":20}`
- Name prefixes: `{"Glass":5,"Flux":6,"Wide":1,"Bent":2,"Rift":3,"Bloom":1,"Phase":1,"Prism":1}`
- Ranges: `{"attackMs":{"min":3,"max":3289,"avg":567.35},"releaseMs":{"min":30,"max":11449,"avg":2515.05},"cutoff":{"min":0.306,"max":1,"avg":0.693},"drive":{"min":0.1,"max":0.854,"avg":0.428},"lfoDepth":{"min":0.093,"max":0.9,"avg":0.581},"lfoToPitch":{"min":0,"max":5,"avg":0.85},"glideMs":{"min":0,"max":370,"avg":80.15}}`
- Flags: none
- Examples: `[{"name":"Glass novel dynamic synth patch, not a preset, s","kind":"wavetable","waveform":"wavetable","envelope":{"attackMs":32,"decayMs":322,"sustain":0.21538149802730489,"releaseMs":611},"knobs":{"cutoff":0.30565834180249757,"resonance":0.5264263540536287,"drive":0.10010444977861106,"color":0.8447444270976094}},{"name":"Flux novel dynamic synth patch, not a preset, su","kind":"wavetable","waveform":"wavetable","envelope":{"attackMs":35,"decayMs":354,"sustain":0.11235727714950092,"releaseMs":734},"knobs":{"cutoff":0.863099743241025,"resonance":0.5604525612110517,"drive":0.6736831021663654,"color":0.8273415650012165}},{"name":"Flux novel dynamic synth patch, not a preset, su","kind":"wavetable","waveform":"wavetable","envelope":{"attackMs":16,"decayMs":136,"sustain":0.2925381909741732,"releaseMs":30},"knobs":{"cutoff":0.9637189794255974,"resonance":0.49605738959091594,"drive":0.5097238878594823,"color":0.931948798672505}}]`


### wavetable

- Prompt: novel wide aggressive evolving bass lead, strange oscillator movement
- Unique fingerprints: 20
- Numeric pairwise distance: 0.194
- Categorical pairwise distance: 0.664
- Schema coverage: `{"total":20,"targetKindMatches":20,"aetherEligible":20,"aetherStackComplete":20,"canonicalSynthPatch":20,"finiteCoreValues":20}`
- Kinds: `{"wavetable":20}`
- Waveforms: `{"wavetable":20}`
- Samples: `{"none":20}`
- Name prefixes: `{"Prism":3,"Wide":2,"Glass":2,"Bent":4,"Volt":3,"Bloom":2,"Rift":1,"Flux":2,"Dust":1}`
- Ranges: `{"attackMs":{"min":33,"max":3901,"avg":715.2},"releaseMs":{"min":191,"max":10901,"avg":2611.8},"cutoff":{"min":0.5,"max":1,"avg":0.826},"drive":{"min":0.003,"max":0.796,"avg":0.336},"lfoDepth":{"min":0.145,"max":0.854,"avg":0.487},"lfoToPitch":{"min":0,"max":5,"avg":1.4},"glideMs":{"min":0,"max":386,"avg":139.95}}`
- Flags: none
- Examples: `[{"name":"Prism novel wide aggressive evolving bass lead, ","kind":"wavetable","waveform":"wavetable","envelope":{"attackMs":214,"decayMs":650,"sustain":0.4144111696325295,"releaseMs":954},"knobs":{"cutoff":1,"resonance":0.6094971444967655,"drive":0.09251445195405486,"color":0.4364383216947029}},{"name":"Wide novel wide aggressive evolving bass lead, s","kind":"wavetable","waveform":"wavetable","envelope":{"attackMs":102,"decayMs":861,"sustain":0.7010866339230383,"releaseMs":781},"knobs":{"cutoff":0.49974193515244025,"resonance":0.7367737357489643,"drive":0.10801254879800254,"color":1}},{"name":"Glass novel wide aggressive evolving bass lead, ","kind":"wavetable","waveform":"wavetable","envelope":{"attackMs":3901,"decayMs":6226,"sustain":0.33458428314634797,"releaseMs":7388},"knobs":{"cutoff":0.9773467386967254,"resonance":0.3596907782460054,"drive":0.10088674689242001,"color":0.6706935213088028}}]`


### hybrid

- Prompt: hybrid punchy sampled transient with synthetic metallic tail
- Unique fingerprints: 20
- Numeric pairwise distance: 0.184
- Categorical pairwise distance: 0.633
- Schema coverage: `{"total":20,"targetKindMatches":20,"aetherEligible":0,"aetherStackComplete":0,"canonicalSynthPatch":0,"finiteCoreValues":20}`
- Kinds: `{"hybrid":20}`
- Waveforms: `{"saw":5,"triangle":3,"sine":2,"square":2,"sample":6,"noise":2}`
- Samples: `{"none":14,"/samples/kick.wav":6}`
- Name prefixes: `{"Phase":2,"Rift":1,"Prism":5,"Flux":2,"Bent":2,"Volt":3,"Wide":2,"Dust":1,"Bloom":2}`
- Ranges: `{"attackMs":{"min":9,"max":5358,"avg":769.8},"releaseMs":{"min":114,"max":9876,"avg":2528.2},"cutoff":{"min":0.254,"max":1,"avg":0.69},"drive":{"min":0,"max":0.733,"avg":0.351},"lfoDepth":{"min":0.221,"max":0.822,"avg":0.536},"lfoToPitch":{"min":0,"max":8,"avg":2.55},"glideMs":{"min":0,"max":350,"avg":101.35}}`
- Flags: none
- Examples: `[{"name":"Phase hybrid punchy sampled transient with synth","kind":"hybrid","waveform":"saw","envelope":{"attackMs":1672,"decayMs":1174,"sustain":0.36120084620136805,"releaseMs":3508},"knobs":{"cutoff":0.7212649540795316,"resonance":0.4414935663535695,"drive":0.6827090300979135,"color":0.9215128567577399}},{"name":"Rift hybrid punchy sampled transient with synthe","kind":"hybrid","waveform":"triangle","envelope":{"attackMs":32,"decayMs":549,"sustain":0.3294586780245689,"releaseMs":303},"knobs":{"cutoff":1,"resonance":0.25526051024685636,"drive":0.2561186346056027,"color":0.7361210779355005}},{"name":"Prism hybrid punchy sampled transient with synth","kind":"hybrid","waveform":"sine","envelope":{"attackMs":147,"decayMs":376,"sustain":0.7177005540010056,"releaseMs":2138},"knobs":{"cutoff":1,"resonance":0.6642030311209164,"drive":0.10515989647696722,"color":0.24378244465276713}}]`


### sampler

- Prompt: dusty sampled flute bell vocal texture with unusual attack
- Unique fingerprints: 20
- Numeric pairwise distance: 0.207
- Categorical pairwise distance: 0.606
- Schema coverage: `{"total":20,"targetKindMatches":20,"aetherEligible":0,"aetherStackComplete":0,"canonicalSynthPatch":0,"finiteCoreValues":20}`
- Kinds: `{"sampler":20}`
- Waveforms: `{"sample":20}`
- Samples: `{"/audio/flute-phrase.wav":4,"/samples/flute.wav":5,"/samples/glass-bell.wav":5,"/samples/vocal-chop.wav":2,"/audio/vocal-texture.wav":2,"/samples/cowbell.wav":2}`
- Name prefixes: `{"Wide":2,"Volt":3,"Rift":3,"Dust":3,"Glass":4,"Bent":1,"Phase":1,"Prism":1,"Flux":1,"Bloom":1}`
- Ranges: `{"attackMs":{"min":5,"max":4114,"avg":708.75},"releaseMs":{"min":77,"max":6063,"avg":2055.4},"cutoff":{"min":0.203,"max":1,"avg":0.62},"drive":{"min":0.028,"max":0.644,"avg":0.359},"lfoDepth":{"min":0.097,"max":0.884,"avg":0.513},"lfoToPitch":{"min":0,"max":12,"avg":4.4},"glideMs":{"min":0,"max":292,"avg":81.4}}`
- Flags: none
- Examples: `[{"name":"Wide dusty sampled flute bell vocal texture with","kind":"sampler","waveform":"sample","sampleUrl":"/audio/flute-phrase.wav","envelope":{"attackMs":3773,"decayMs":5061,"sustain":0.9350197147089148,"releaseMs":3837},"knobs":{"cutoff":0.20337821816717191,"resonance":0.5261632879852147,"drive":0.2919829165909825,"color":0.5288647119013429}},{"name":"Volt dusty sampled flute bell vocal texture with","kind":"sampler","waveform":"sample","sampleUrl":"/samples/flute.wav","envelope":{"attackMs":3212,"decayMs":5151,"sustain":0.35288440255116876,"releaseMs":6063},"knobs":{"cutoff":0.2184597092161233,"resonance":0.5928181306984359,"drive":0.14090101856011944,"color":0.55466293568032}},{"name":"Rift dusty sampled flute bell vocal texture with","kind":"sampler","waveform":"sample","sampleUrl":"/samples/glass-bell.wav","envelope":{"attackMs":23,"decayMs":83,"sustain":0.12790918021831157,"releaseMs":77},"knobs":{"cutoff":0.6566259220273356,"resonance":0.42504182200182317,"drive":0.46705661337615767,"color":0.7839822730093646}}]`


## Beat Generation

### rock

- Unique fingerprints: 20
- Rhythm pairwise distance: 0.717
- Rows: `{"min":3,"max":7,"avg":4.75}`
- Hits: `{"min":7,"max":23,"avg":15.55}`
- Speed: `{"min":3,"max":4,"avg":3.75}`
- Swing: `{"min":45,"max":55,"avg":50.35}`
- Velocity span: `{"min":74,"max":109,"avg":101.9}`
- Unique row sets: 17
- Most common row sets: `[{"value":"Crash Cymbal, Mid Tom, Open Hat, Punchy Kick, Snappy Snare","count":2},{"value":"Closed Hat, Crash Cymbal, Mid Tom, Punchy Kick, Snappy Snare","count":2},{"value":"Closed Hat, Crash Cymbal, Punchy Kick, Snappy Snare","count":2}]`
- Flags: none
- Examples: `[{"rows":[{"name":"Punchy Kick","hits":[1,5,8,9]},{"name":"Snappy Snare","hits":[5,7,13]},{"name":"Open Hat","hits":[1,3,5,7,8,9,11,13,15]},{"name":"Crash Cymbal","hits":[1]},{"name":"Mid Tom","hits":[1,3]}],"speed":4,"swingPercent":50},{"rows":[{"name":"Punchy Kick","hits":[1,9,16]},{"name":"Snappy Snare","hits":[5,9,13]},{"name":"Open Hat","hits":[1,3,5,7,8,9,11,13,15]},{"name":"Mid Tom","hits":[1,13]}],"speed":4,"swingPercent":53},{"rows":[{"name":"Punchy Kick","hits":[1,5,9]},{"name":"Snappy Snare","hits":[5,9,13]},{"name":"Closed Hat","hits":[1,3,5,7,9,11,13,15]},{"name":"Crash Cymbal","hits":[1,9]},{"name":"Mid Tom","hits":[11,16]}],"speed":4,"swingPercent":52}]`


### pop

- Unique fingerprints: 20
- Rhythm pairwise distance: 0.552
- Rows: `{"min":3,"max":6,"avg":4.9}`
- Hits: `{"min":12,"max":29,"avg":18.7}`
- Speed: `{"min":3,"max":5,"avg":3.95}`
- Swing: `{"min":45,"max":55,"avg":50.95}`
- Velocity span: `{"min":95,"max":110,"avg":104.5}`
- Unique row sets: 13
- Most common row sets: `[{"value":"Analog Clap, Closed Hat, Crash Cymbal, Punchy Kick, Uploaded Pop Shaker","count":3},{"value":"Analog Clap, Closed Hat, Punchy Kick, Tambourine, Uploaded Pop Shaker","count":3},{"value":"Analog Clap, Closed Hat, Crash Cymbal, Mid Tom, Punchy Kick","count":2}]`
- Flags: none
- Examples: `[{"rows":[{"name":"Punchy Kick","hits":[1,7,9,15,17,18]},{"name":"Analog Clap","hits":[5,11,13]},{"name":"Closed Hat","hits":[1,3,5,7,9,11,13,15,17,19]},{"name":"Mid Tom","hits":[12,14]}],"speed":5,"swingPercent":49},{"rows":[{"name":"Punchy Kick","hits":[1,7,9,15,16]},{"name":"Analog Clap","hits":[5,9,13]},{"name":"Closed Hat","hits":[1,2,3,5,7,9,11,13,15]},{"name":"Uploaded Pop Shaker","hits":[13,15]},{"name":"Crash Cymbal","hits":[1]},{"name":"Mid Tom","hits":[11,14,16]}],"speed":4,"swingPercent":55},{"rows":[{"name":"Punchy Kick","hits":[1,7,9,15]},{"name":"Analog Clap","hits":[5,9,13]},{"name":"Closed Hat","hits":[1,3,5,7,9,11,13,15]},{"name":"Crash Cymbal","hits":[1]},{"name":"Mid Tom","hits":[8,14]}],"speed":4,"swingPercent":50}]`


### rap

- Unique fingerprints: 20
- Rhythm pairwise distance: 0.603
- Rows: `{"min":3,"max":6,"avg":4.9}`
- Hits: `{"min":10,"max":31,"avg":19.05}`
- Speed: `{"min":3,"max":5,"avg":4}`
- Swing: `{"min":53,"max":71,"avg":62.75}`
- Velocity span: `{"min":81,"max":109,"avg":104}`
- Unique row sets: 14
- Most common row sets: `[{"value":"Closed Hat, Punchy Kick, Rim Click, Snappy Snare","count":3},{"value":"Closed Hat, Crash Cymbal, Punchy Kick, Rim Click, Snappy Snare","count":3},{"value":"Closed Hat, Punchy Kick, Rim Click, Snappy Snare, Uploaded Pop Shaker","count":2}]`
- Flags: none
- Examples: `[{"rows":[{"name":"Punchy Kick","hits":[1,7,11,14,15,17]},{"name":"Snappy Snare","hits":[5,11,13]},{"name":"Closed Hat","hits":[1,3,5,7,9,11,13,15,17,19]},{"name":"Rim Click","hits":[11,15]}],"speed":5,"swingPercent":66},{"rows":[{"name":"Punchy Kick","hits":[1,4,7,11,15]},{"name":"Snappy Snare","hits":[5,9,13]},{"name":"Closed Hat","hits":[1,3,5,7,9,10,11,13,15]},{"name":"Rim Click","hits":[9,11,15]},{"name":"Crash Cymbal","hits":[1]},{"name":"Mid Tom","hits":[7,8,14]}],"speed":4,"swingPercent":67},{"rows":[{"name":"Punchy Kick","hits":[1,9,11,12]},{"name":"Snappy Snare","hits":[5,9,13]},{"name":"Closed Hat","hits":[1,3,5,9,11,13,15]},{"name":"Rim Click","hits":[9,11,15]},{"name":"Crash Cymbal","hits":[1]}],"speed":4,"swingPercent":53}]`


### trap

- Unique fingerprints: 20
- Rhythm pairwise distance: 0.794
- Rows: `{"min":3,"max":7,"avg":4.75}`
- Hits: `{"min":6,"max":25,"avg":13.95}`
- Speed: `{"min":3,"max":5,"avg":4.5}`
- Swing: `{"min":47,"max":55,"avg":51.85}`
- Velocity span: `{"min":31,"max":109,"avg":92.35}`
- Unique row sets: 17
- Most common row sets: `[{"value":"Closed Hat, Punchy Kick, Rim Click, Snappy Snare","count":3},{"value":"Analog Clap, Punchy Kick, Snappy Snare","count":2},{"value":"Crash Cymbal, Punchy Kick, Rim Click, Snappy Snare, Uploaded Pop Shaker","count":1}]`
- Flags: none
- Examples: `[{"rows":[{"name":"Punchy Kick","hits":[1,7,10,12,16,19]},{"name":"Snappy Snare","hits":[11]},{"name":"Uploaded Pop Shaker","hits":[1,11,13]},{"name":"Rim Click","hits":[11]},{"name":"Crash Cymbal","hits":[1,11]}],"speed":5,"swingPercent":53},{"rows":[{"name":"Punchy Kick","hits":[1,3,7,12,16,19]},{"name":"Snappy Snare","hits":[11]},{"name":"Uploaded Pop Shaker","hits":[1,5,11]},{"name":"Rim Click","hits":[11]}],"speed":5,"swingPercent":52},{"rows":[{"name":"Punchy Kick","hits":[1,6,9,13]},{"name":"Snappy Snare","hits":[9]},{"name":"Closed Hat","hits":[1,3,7,9,10,11,14,15]},{"name":"Analog Clap","hits":[9]},{"name":"Crash Cymbal","hits":[1]}],"speed":4,"swingPercent":55}]`


### drill

- Unique fingerprints: 20
- Rhythm pairwise distance: 0.789
- Rows: `{"min":3,"max":6,"avg":4.45}`
- Hits: `{"min":10,"max":32,"avg":18.6}`
- Speed: `{"min":3,"max":5,"avg":4.45}`
- Swing: `{"min":51,"max":64,"avg":57.8}`
- Velocity span: `{"min":103,"max":113,"avg":108.05}`
- Unique row sets: 12
- Most common row sets: `[{"value":"Closed Hat, Low Tom, Punchy Kick, Snappy Snare","count":4},{"value":"Low Tom, Open Hat, Punchy Kick, Snappy Snare","count":3},{"value":"Crash Cymbal, Low Tom, Open Hat, Punchy Kick, Snappy Snare","count":2}]`
- Flags: none
- Examples: `[{"rows":[{"name":"Punchy Kick","hits":[1,7,9]},{"name":"Snappy Snare","hits":[7]},{"name":"Open Hat","hits":[1,2,7,8,9,11]},{"name":"Low Tom","hits":[9]},{"name":"Crash Cymbal","hits":[1]}],"speed":3,"swingPercent":63},{"rows":[{"name":"Punchy Kick","hits":[1,8,9,15]},{"name":"Snappy Snare","hits":[9]},{"name":"Closed Hat","hits":[1,3,5,6,7,9,10,13,15]},{"name":"Open Hat","hits":[4,8,12]},{"name":"Uploaded Pop Shaker","hits":[5,8]}],"speed":4,"swingPercent":62},{"rows":[{"name":"Punchy Kick","hits":[1,3,7,10,14,19]},{"name":"Snappy Snare","hits":[11]},{"name":"Closed Hat","hits":[1,3,5,7,9,11,12,14,15,16,19]},{"name":"Open Hat","hits":[2,5,12,14,15]},{"name":"Crash Cymbal","hits":[1]},{"name":"Uploaded Pop Shaker","hits":[11,19]}],"speed":5,"swingPercent":58}]`


### breakcore

- Unique fingerprints: 20
- Rhythm pairwise distance: 0.834
- Rows: `{"min":4,"max":6,"avg":5.45}`
- Hits: `{"min":13,"max":24,"avg":18.4}`
- Speed: `{"min":4,"max":6,"avg":5.35}`
- Swing: `{"min":51,"max":60,"avg":55.4}`
- Velocity span: `{"min":92,"max":110,"avg":103.1}`
- Unique row sets: 11
- Most common row sets: `[{"value":"Foley Percussion, Punchy Kick, Snappy Snare, Tambourine, Uploaded Amen Break, Uploaded Pop Shaker","count":4},{"value":"Foley Percussion, Punchy Kick, Snappy Snare, Uploaded Amen Break, Uploaded Pop Shaker","count":3},{"value":"Cowbell, Crash Cymbal, Punchy Kick, Snappy Snare, Uploaded Amen Break","count":3}]`
- Flags: none
- Examples: `[{"rows":[{"name":"Punchy Kick","hits":[1,9,12,13,18,21,24]},{"name":"Snappy Snare","hits":[5,13,16,24]},{"name":"Uploaded Amen Break","hits":[1,9,23]},{"name":"Uploaded Pop Shaker","hits":[5,9,15]},{"name":"Foley Percussion","hits":[2,16,20]}],"speed":6,"swingPercent":55},{"rows":[{"name":"Punchy Kick","hits":[1,4,7,11,13,17]},{"name":"Snappy Snare","hits":[3,5,11,17]},{"name":"Uploaded Amen Break","hits":[1,9,10]},{"name":"Crash Cymbal","hits":[1]},{"name":"Cowbell","hits":[2,3,4]}],"speed":5,"swingPercent":56},{"rows":[{"name":"Punchy Kick","hits":[1,5,6,11,12,17]},{"name":"Snappy Snare","hits":[5,9,11,17]},{"name":"Uploaded Amen Break","hits":[1,17]},{"name":"Crash Cymbal","hits":[1]},{"name":"Uploaded Pop Shaker","hits":[13,19]}],"speed":5,"swingPercent":54}]`


### dnb

- Unique fingerprints: 20
- Rhythm pairwise distance: 0.706
- Rows: `{"min":4,"max":7,"avg":5.55}`
- Hits: `{"min":19,"max":37,"avg":28.25}`
- Speed: `{"min":4,"max":6,"avg":5.3}`
- Swing: `{"min":47,"max":62,"avg":53.55}`
- Velocity span: `{"min":107,"max":114,"avg":109.3}`
- Unique row sets: 11
- Most common row sets: `[{"value":"Closed Hat, Crash Cymbal, Punchy Kick, Ride Cymbal, Snappy Snare","count":6},{"value":"Closed Hat, Crash Cymbal, Punchy Kick, Ride Cymbal, Snappy Snare, Uploaded Pop Shaker","count":3},{"value":"Closed Hat, Punchy Kick, Ride Cymbal, Snappy Snare, Tambourine, Uploaded Pop Shaker","count":2}]`
- Flags: none
- Examples: `[{"rows":[{"name":"Punchy Kick","hits":[1,8,9,11,12,13,18]},{"name":"Snappy Snare","hits":[7,13,19,22]},{"name":"Closed Hat","hits":[1,3,6,7,9,10,12,13,15,18,19,21,22]},{"name":"Ride Cymbal","hits":[4,5,10,18]},{"name":"Crash Cymbal","hits":[1]}],"speed":6,"swingPercent":52},{"rows":[{"name":"Punchy Kick","hits":[1,7,11,15]},{"name":"Snappy Snare","hits":[6,11,16,17]},{"name":"Closed Hat","hits":[1,5,7,9,11,12,15,16,17,18,19]},{"name":"Ride Cymbal","hits":[3,9,13,14]},{"name":"Crash Cymbal","hits":[1]},{"name":"Uploaded Pop Shaker","hits":[11,15,19]},{"name":"Mid Tom","hits":[5,9,10]}],"speed":5,"swingPercent":50},{"rows":[{"name":"Punchy Kick","hits":[1,4,7,8,9,13,18]},{"name":"Snappy Snare","hits":[7,13,19,22]},{"name":"Closed Hat","hits":[1,3,7,9,11,13,14,15,16,18,21,22,24]},{"name":"Ride Cymbal","hits":[8,10,19,21,22]},{"name":"Crash Cymbal","hits":[1,21]}],"speed":6,"swingPercent":48}]`


### house

- Unique fingerprints: 20
- Rhythm pairwise distance: 0.583
- Rows: `{"min":3,"max":6,"avg":4.25}`
- Hits: `{"min":10,"max":28,"avg":16.75}`
- Speed: `{"min":3,"max":5,"avg":4}`
- Swing: `{"min":50,"max":58,"avg":54.4}`
- Velocity span: `{"min":83,"max":109,"avg":103.95}`
- Unique row sets: 10
- Most common row sets: `[{"value":"Analog Clap, Closed Hat, Open Hat, Punchy Kick","count":4},{"value":"Analog Clap, Open Hat, Punchy Kick, Uploaded Pop Shaker","count":4},{"value":"Analog Clap, Closed Hat, Crash Cymbal, Open Hat, Punchy Kick","count":3}]`
- Flags: none
- Examples: `[{"rows":[{"name":"Punchy Kick","hits":[1,5,9]},{"name":"Snappy Snare","hits":[5,7]},{"name":"Open Hat","hits":[5,7,11,12]},{"name":"Uploaded Pop Shaker","hits":[1,7]},{"name":"Crash Cymbal","hits":[1,7]},{"name":"Cowbell","hits":[]}],"speed":3,"swingPercent":54},{"rows":[{"name":"Punchy Kick","hits":[1,5,9,13]},{"name":"Analog Clap","hits":[5,13]},{"name":"Open Hat","hits":[3,6,7,10,11,12,13,15,16]},{"name":"Closed Hat","hits":[1,3,4,5,8,9,11,13,15]}],"speed":4,"swingPercent":58},{"rows":[{"name":"Punchy Kick","hits":[1,5,9,11,13,17]},{"name":"Analog Clap","hits":[5,11,13]},{"name":"Open Hat","hits":[3,7,11,15,18,19,20]},{"name":"Closed Hat","hits":[1,3,5,7,9,11,13,15,16,17,19]},{"name":"Crash Cymbal","hits":[1]}],"speed":5,"swingPercent":54}]`


### reggae

- Unique fingerprints: 20
- Rhythm pairwise distance: 0.691
- Rows: `{"min":3,"max":6,"avg":4.65}`
- Hits: `{"min":6,"max":20,"avg":12.9}`
- Speed: `{"min":3,"max":5,"avg":3.9}`
- Swing: `{"min":50,"max":67,"avg":59.95}`
- Velocity span: `{"min":88,"max":109,"avg":101.55}`
- Unique row sets: 10
- Most common row sets: `[{"value":"Closed Hat, Crash Cymbal, Punchy Kick, Rim Click","count":4},{"value":"Closed Hat, Crash Cymbal, Low Conga, Punchy Kick, Rim Click","count":3},{"value":"Closed Hat, Foley Percussion, Punchy Kick, Rim Click, Tambourine, Uploaded Pop Shaker","count":2}]`
- Flags: none
- Examples: `[{"rows":[{"name":"Punchy Kick","hits":[7,9]},{"name":"Rim Click","hits":[9]},{"name":"Closed Hat","hits":[2,3,7,11,12,13,15]},{"name":"Foley Percussion","hits":[5,13]},{"name":"Uploaded Pop Shaker","hits":[7,12]},{"name":"Tambourine","hits":[5,6,7,12]}],"speed":4,"swingPercent":66},{"rows":[{"name":"Punchy Kick","hits":[9,10]},{"name":"Rim Click","hits":[9,13]},{"name":"Closed Hat","hits":[7,9,10,11,12,13,15]},{"name":"Crash Cymbal","hits":[1]}],"speed":4,"swingPercent":62},{"rows":[{"name":"Punchy Kick","hits":[9]},{"name":"Rim Click","hits":[3,4,9]},{"name":"Closed Hat","hits":[1,3,5,7,10,11,15]},{"name":"Foley Percussion","hits":[5,13]},{"name":"Uploaded Pop Shaker","hits":[9,11]}],"speed":4,"swingPercent":60}]`


### funk

- Unique fingerprints: 20
- Rhythm pairwise distance: 0.577
- Rows: `{"min":5,"max":7,"avg":5.7}`
- Hits: `{"min":13,"max":30,"avg":21.55}`
- Speed: `{"min":3,"max":4,"avg":3.9}`
- Swing: `{"min":53,"max":72,"avg":60.65}`
- Velocity span: `{"min":104,"max":114,"avg":108.9}`
- Unique row sets: 14
- Most common row sets: `[{"value":"Closed Hat, Open Hat, Punchy Kick, Snappy Snare, Uploaded Pop Shaker","count":4},{"value":"Closed Hat, Low Conga, Open Hat, Punchy Kick, Snappy Snare, Uploaded Pop Shaker","count":2},{"value":"Closed Hat, Low Conga, Open Hat, Punchy Kick, Snappy Snare","count":2}]`
- Flags: none
- Examples: `[{"rows":[{"name":"Punchy Kick","hits":[1,9,11,12,15]},{"name":"Snappy Snare","hits":[5,9,13]},{"name":"Closed Hat","hits":[1,3,5,6,7,9,11,13,15]},{"name":"Open Hat","hits":[5,11,12,15]},{"name":"Crash Cymbal","hits":[1]},{"name":"Uploaded Pop Shaker","hits":[6,11]},{"name":"Low Conga","hits":[6,13]}],"speed":4,"swingPercent":61},{"rows":[{"name":"Punchy Kick","hits":[1,7,9,11,14]},{"name":"Snappy Snare","hits":[5,12,13]},{"name":"Closed Hat","hits":[1,3,5,7,9,11,12,13,15]},{"name":"Open Hat","hits":[6,15]},{"name":"Uploaded Pop Shaker","hits":[7,15]},{"name":"Cowbell","hits":[10,13]}],"speed":4,"swingPercent":68},{"rows":[{"name":"Punchy Kick","hits":[1,5,9,11]},{"name":"Snappy Snare","hits":[5,9,13]},{"name":"Closed Hat","hits":[1,3,5,7,9,11,13,15]},{"name":"Open Hat","hits":[7,11,15]},{"name":"Crash Cymbal","hits":[1]},{"name":"Mid Tom","hits":[8,16]}],"speed":4,"swingPercent":61}]`


## MIDI Generation

### melody

- Unique fingerprints: 20
- Event pairwise distance: 0.998
- Pitch pairwise distance: 0.785
- Rhythm pairwise distance: 0.996
- Note count: `{"min":3,"max":18,"avg":9.5}`
- Pitch span: `{"min":5,"max":20,"avg":13.75}`
- Flags: none
- Examples: `[[{"pitch":60,"startBeat":0,"lengthBeats":0.453,"velocity":95},{"pitch":60,"startBeat":0.75,"lengthBeats":0.151,"velocity":77},{"pitch":65,"startBeat":1.25,"lengthBeats":0.302,"velocity":81},{"pitch":60,"startBeat":2.125,"lengthBeats":0.226,"velocity":108},{"pitch":60,"startBeat":2.5,"lengthBeats":0.226,"velocity":78},{"pitch":60,"startBeat":2.875,"lengthBeats":0.226,"velocity":67},{"pitch":63,"startBeat":3.25,"lengthBeats":0.226,"velocity":109},{"pitch":60,"startBeat":3.625,"lengthBeats":0.151,"velocity":85},{"pitch":70,"startBeat":3.875,"lengthBeats":0.226,"velocity":78},{"pitch":68,"startBeat":4.25,"lengthBeats":0.226,"velocity":92},{"pitch":62,"startBeat":4.625,"lengthBeats":0.302,"velocity":77},{"pitch":77,"startBeat":5.125,"lengthBeats":0.453,"velocity":111},{"pitch":63,"startBeat":5.875,"lengthBeats":0.302,"velocity":87},{"pitch":65,"startBeat":6.375,"lengthBeats":0.151,"velocity":83},{"pitch":65,"startBeat":6.625,"lengthBeats":0.151,"velocity":107},{"pitch":77,"startBeat":6.875,"lengthBeats":0.151,"velocity":101},{"pitch":65,"startBeat":7.125,"lengthBeats":0.302,"velocity":102},{"pitch":77,"startBeat":7.875,"lengthBeats":0.125,"velocity":83}],[{"pitch":75,"startBeat":0,"lengthBeats":1.157,"velocity":93},{"pitch":80,"startBeat":2,"lengthBeats":0.578,"velocity":66},{"pitch":79,"startBeat":3,"lengthBeats":1.735,"velocity":107}],[{"pitch":62,"startBeat":0,"lengthBeats":0.981,"velocity":105},{"pitch":68,"startBeat":6.5,"lengthBeats":0.49,"velocity":75},{"pitch":75,"startBeat":7.5,"lengthBeats":0.49,"velocity":93}]]`


### bass

- Unique fingerprints: 20
- Event pairwise distance: 0.967
- Pitch pairwise distance: 0.577
- Rhythm pairwise distance: 0.998
- Note count: `{"min":6,"max":14,"avg":9.7}`
- Pitch span: `{"min":8,"max":22,"avg":17.9}`
- Flags: none
- Examples: `[[{"pitch":36,"startBeat":0,"lengthBeats":1.369,"velocity":94},{"pitch":41,"startBeat":2,"lengthBeats":1.369,"velocity":106},{"pitch":41,"startBeat":2.75,"lengthBeats":0.538,"velocity":77},{"pitch":44,"startBeat":4,"lengthBeats":1.369,"velocity":90},{"pitch":44,"startBeat":4.75,"lengthBeats":0.538,"velocity":81},{"pitch":43,"startBeat":6,"lengthBeats":1.369,"velocity":112}],[{"pitch":41,"startBeat":0,"lengthBeats":1.568,"velocity":91},{"pitch":44,"startBeat":0.5,"lengthBeats":0.463,"velocity":94},{"pitch":44,"startBeat":1.5,"lengthBeats":0.463,"velocity":95},{"pitch":44,"startBeat":2,"lengthBeats":1.568,"velocity":91},{"pitch":36,"startBeat":3,"lengthBeats":0.463,"velocity":83},{"pitch":48,"startBeat":4,"lengthBeats":1.568,"velocity":91},{"pitch":36,"startBeat":4.5,"lengthBeats":0.463,"velocity":95},{"pitch":50,"startBeat":5,"lengthBeats":0.463,"velocity":94},{"pitch":43,"startBeat":5.5,"lengthBeats":0.463,"velocity":88},{"pitch":43,"startBeat":6,"lengthBeats":1.568,"velocity":96},{"pitch":46,"startBeat":6.5,"lengthBeats":0.463,"velocity":70},{"pitch":55,"startBeat":7,"lengthBeats":0.463,"velocity":96},{"pitch":46,"startBeat":7.5,"lengthBeats":0.463,"velocity":95}],[{"pitch":36,"startBeat":0,"lengthBeats":1.316,"velocity":92},{"pitch":44,"startBeat":2,"lengthBeats":1.316,"velocity":110},{"pitch":46,"startBeat":3,"lengthBeats":0.663,"velocity":76},{"pitch":41,"startBeat":4,"lengthBeats":1.316,"velocity":94},{"pitch":55,"startBeat":5,"lengthBeats":0.663,"velocity":94},{"pitch":43,"startBeat":6,"lengthBeats":1.316,"velocity":116},{"pitch":43,"startBeat":7,"lengthBeats":0.663,"velocity":64}]]`


### chords

- Unique fingerprints: 20
- Event pairwise distance: 0.971
- Pitch pairwise distance: 0.436
- Rhythm pairwise distance: 0.995
- Note count: `{"min":12,"max":21,"avg":14.55}`
- Pitch span: `{"min":19,"max":35,"avg":27.3}`
- Flags: none
- Examples: `[[{"pitch":94,"startBeat":0,"lengthBeats":1.308,"velocity":62},{"pitch":74,"startBeat":0,"lengthBeats":1.308,"velocity":81},{"pitch":65,"startBeat":0,"lengthBeats":1.308,"velocity":79},{"pitch":86,"startBeat":2,"lengthBeats":1.308,"velocity":73},{"pitch":65,"startBeat":2,"lengthBeats":1.308,"velocity":62},{"pitch":69,"startBeat":2,"lengthBeats":1.308,"velocity":82},{"pitch":77,"startBeat":4,"lengthBeats":1.308,"velocity":67},{"pitch":69,"startBeat":4,"lengthBeats":1.308,"velocity":74},{"pitch":72,"startBeat":4,"lengthBeats":1.308,"velocity":82},{"pitch":96,"startBeat":6,"lengthBeats":1.308,"velocity":68},{"pitch":76,"startBeat":6,"lengthBeats":1.308,"velocity":72},{"pitch":67,"startBeat":6,"lengthBeats":1.308,"velocity":66}],[{"pitch":77,"startBeat":0,"lengthBeats":1.77,"velocity":69},{"pitch":81,"startBeat":0,"lengthBeats":1.77,"velocity":64},{"pitch":72,"startBeat":0,"lengthBeats":1.77,"velocity":64},{"pitch":82,"startBeat":2,"lengthBeats":1.77,"velocity":76},{"pitch":86,"startBeat":2,"lengthBeats":1.77,"velocity":74},{"pitch":65,"startBeat":2,"lengthBeats":1.77,"velocity":61},{"pitch":81,"startBeat":2,"lengthBeats":1.77,"velocity":78},{"pitch":98,"startBeat":4,"lengthBeats":1.77,"velocity":71},{"pitch":77,"startBeat":4,"lengthBeats":1.77,"velocity":65},{"pitch":69,"startBeat":4,"lengthBeats":1.77,"velocity":60},{"pitch":74,"startBeat":4,"lengthBeats":1.77,"velocity":78},{"pitch":84,"startBeat":6,"lengthBeats":1.77,"velocity":70},{"pitch":100,"startBeat":6,"lengthBeats":1.77,"velocity":74},{"pitch":67,"startBeat":6,"lengthBeats":1.77,"velocity":73}],[{"pitch":77,"startBeat":0,"lengthBeats":1.722,"velocity":76},{"pitch":81,"startBeat":0,"lengthBeats":1.722,"velocity":73},{"pitch":72,"startBeat":0,"lengthBeats":1.722,"velocity":68},{"pitch":82,"startBeat":2,"lengthBeats":1.722,"velocity":66},{"pitch":86,"startBeat":2,"lengthBeats":1.722,"velocity":84},{"pitch":77,"startBeat":2,"lengthBeats":1.722,"velocity":65},{"pitch":86,"startBeat":4,"lengthBeats":1.722,"velocity":77},{"pitch":89,"startBeat":4,"lengthBeats":1.722,"velocity":61},{"pitch":81,"startBeat":4,"lengthBeats":1.722,"velocity":80},{"pitch":96,"startBeat":6,"lengthBeats":1.722,"velocity":58},{"pitch":88,"startBeat":6,"lengthBeats":1.722,"velocity":74},{"pitch":67,"startBeat":6,"lengthBeats":1.722,"velocity":72},{"pitch":72,"startBeat":6,"lengthBeats":1.722,"velocity":84}]]`


### arp

- Unique fingerprints: 20
- Event pairwise distance: 0.992
- Pitch pairwise distance: 0.51
- Rhythm pairwise distance: 0.995
- Note count: `{"min":14,"max":32,"avg":21.15}`
- Pitch span: `{"min":19,"max":34,"avg":27.05}`
- Flags: none
- Examples: `[[{"pitch":77,"startBeat":0,"lengthBeats":0.202,"velocity":93},{"pitch":74,"startBeat":0.25,"lengthBeats":0.202,"velocity":67},{"pitch":86,"startBeat":0.5,"lengthBeats":0.202,"velocity":64},{"pitch":82,"startBeat":0.75,"lengthBeats":0.202,"velocity":55},{"pitch":94,"startBeat":1,"lengthBeats":0.202,"velocity":59},{"pitch":77,"startBeat":1.25,"lengthBeats":0.202,"velocity":82},{"pitch":74,"startBeat":1.5,"lengthBeats":0.202,"velocity":89},{"pitch":82,"startBeat":1.75,"lengthBeats":0.202,"velocity":82},{"pitch":77,"startBeat":2,"lengthBeats":0.202,"velocity":74},{"pitch":60,"startBeat":2.25,"lengthBeats":0.202,"velocity":54},{"pitch":89,"startBeat":2.5,"lengthBeats":0.202,"velocity":88},{"pitch":77,"startBeat":2.75,"lengthBeats":0.202,"velocity":82},{"pitch":89,"startBeat":3,"lengthBeats":0.202,"velocity":72},{"pitch":72,"startBeat":3.25,"lengthBeats":0.202,"velocity":88},{"pitch":80,"startBeat":3.5,"lengthBeats":0.202,"velocity":84},{"pitch":77,"startBeat":3.75,"lengthBeats":0.202,"velocity":89},{"pitch":82,"startBeat":4,"lengthBeats":0.202,"velocity":64},{"pitch":79,"startBeat":4.25,"lengthBeats":0.202,"velocity":68},{"pitch":91,"startBeat":4.5,"lengthBeats":0.202,"velocity":68},{"pitch":75,"startBeat":4.75,"lengthBeats":0.202,"velocity":78},{"pitch":75,"startBeat":5,"lengthBeats":0.202,"velocity":62},{"pitch":79,"startBeat":5.25,"lengthBeats":0.202,"velocity":92},{"pitch":79,"startBeat":5.5,"lengthBeats":0.202,"velocity":70},{"pitch":63,"startBeat":5.75,"lengthBeats":0.202,"velocity":85},{"pitch":79,"startBeat":6,"lengthBeats":0.202,"velocity":63},{"pitch":74,"startBeat":6.25,"lengthBeats":0.202,"velocity":83},{"pitch":82,"startBeat":6.5,"lengthBeats":0.202,"velocity":80},{"pitch":91,"startBeat":6.75,"lengthBeats":0.202,"velocity":93},{"pitch":91,"startBeat":7,"lengthBeats":0.202,"velocity":67},{"pitch":74,"startBeat":7.25,"lengthBeats":0.202,"velocity":84},{"pitch":79,"startBeat":7.5,"lengthBeats":0.202,"velocity":74},{"pitch":79,"startBeat":7.75,"lengthBeats":0.202,"velocity":79}],[{"pitch":68,"startBeat":0,"lengthBeats":0.163,"velocity":91},{"pitch":92,"startBeat":0.25,"lengthBeats":0.163,"velocity":56},{"pitch":77,"startBeat":0.5,"lengthBeats":0.163,"velocity":55},{"pitch":77,"startBeat":0.75,"lengthBeats":0.163,"velocity":69},{"pitch":80,"startBeat":1,"lengthBeats":0.163,"velocity":87},{"pitch":80,"startBeat":1.25,"lengthBeats":0.163,"velocity":72},{"pitch":74,"startBeat":1.5,"lengthBeats":0.163,"velocity":65},{"pitch":89,"startBeat":1.75,"lengthBeats":0.163,"velocity":57},{"pitch":77,"startBeat":2,"lengthBeats":0.163,"velocity":82},{"pitch":91,"startBeat":2.25,"lengthBeats":0.163,"velocity":67},{"pitch":84,"startBeat":2.5,"lengthBeats":0.163,"velocity":91},{"pitch":75,"startBeat":2.75,"lengthBeats":0.163,"velocity":61},{"pitch":89,"startBeat":3,"lengthBeats":0.163,"velocity":75},{"pitch":72,"startBeat":3.25,"lengthBeats":0.163,"velocity":86},{"pitch":84,"startBeat":3.5,"lengthBeats":0.163,"velocity":59},{"pitch":87,"startBeat":3.75,"lengthBeats":0.163,"velocity":86},{"pitch":82,"startBeat":4,"lengthBeats":0.163,"velocity":83},{"pitch":72,"startBeat":4.25,"lengthBeats":0.163,"velocity":87},{"pitch":89,"startBeat":4.5,"lengthBeats":0.163,"velocity":61},{"pitch":70,"startBeat":4.75,"lengthBeats":0.163,"velocity":70},{"pitch":82,"startBeat":5,"lengthBeats":0.163,"velocity":85},{"pitch":72,"startBeat":5.25,"lengthBeats":0.163,"velocity":93},{"pitch":77,"startBeat":5.5,"lengthBeats":0.163,"velocity":77},{"pitch":70,"startBeat":5.75,"lengthBeats":0.163,"velocity":81},{"pitch":87,"startBeat":6,"lengthBeats":0.163,"velocity":86},{"pitch":70,"startBeat":6.25,"lengthBeats":0.163,"velocity":52},{"pitch":74,"startBeat":6.75,"lengthBeats":0.163,"velocity":68},{"pitch":75,"startBeat":7,"lengthBeats":0.163,"velocity":77},{"pitch":89,"startBeat":7.25,"lengthBeats":0.163,"velocity":66},{"pitch":82,"startBeat":7.5,"lengthBeats":0.163,"velocity":80},{"pitch":87,"startBeat":7.75,"lengthBeats":0.163,"velocity":67}],[{"pitch":80,"startBeat":0,"lengthBeats":0.254,"velocity":84},{"pitch":92,"startBeat":0.5,"lengthBeats":0.254,"velocity":86},{"pitch":74,"startBeat":1,"lengthBeats":0.254,"velocity":60},{"pitch":86,"startBeat":1.5,"lengthBeats":0.254,"velocity":69},{"pitch":72,"startBeat":2,"lengthBeats":0.254,"velocity":83},{"pitch":91,"startBeat":2.5,"lengthBeats":0.254,"velocity":86},{"pitch":75,"startBeat":3,"lengthBeats":0.254,"velocity":77},{"pitch":72,"startBeat":3.5,"lengthBeats":0.254,"velocity":94},{"pitch":77,"startBeat":4,"lengthBeats":0.254,"velocity":86},{"pitch":77,"startBeat":4.5,"lengthBeats":0.254,"velocity":73},{"pitch":82,"startBeat":5,"lengthBeats":0.254,"velocity":82},{"pitch":82,"startBeat":5.5,"lengthBeats":0.254,"velocity":69},{"pitch":80,"startBeat":6,"lengthBeats":0.254,"velocity":53},{"pitch":75,"startBeat":6.5,"lengthBeats":0.254,"velocity":76},{"pitch":72,"startBeat":7,"lengthBeats":0.254,"velocity":64},{"pitch":80,"startBeat":7.5,"lengthBeats":0.254,"velocity":67}]]`


### countermelody

- Unique fingerprints: 20
- Event pairwise distance: 0.999
- Pitch pairwise distance: 0.717
- Rhythm pairwise distance: 0.997
- Note count: `{"min":4,"max":17,"avg":8.45}`
- Pitch span: `{"min":5,"max":22,"avg":17.1}`
- Flags: none
- Examples: `[[{"pitch":86,"startBeat":2.25,"lengthBeats":0.944,"velocity":71},{"pitch":94,"startBeat":3.375,"lengthBeats":0.629,"velocity":102},{"pitch":84,"startBeat":4.875,"lengthBeats":0.629,"velocity":91},{"pitch":72,"startBeat":5.625,"lengthBeats":0.629,"velocity":100},{"pitch":89,"startBeat":6.375,"lengthBeats":0.629,"velocity":82}],[{"pitch":79,"startBeat":0.75,"lengthBeats":0.194,"velocity":95},{"pitch":80,"startBeat":1,"lengthBeats":0.388,"velocity":70},{"pitch":80,"startBeat":1.5,"lengthBeats":0.388,"velocity":92},{"pitch":94,"startBeat":3,"lengthBeats":0.388,"velocity":93},{"pitch":77,"startBeat":4,"lengthBeats":0.194,"velocity":84},{"pitch":75,"startBeat":5,"lengthBeats":0.582,"velocity":83},{"pitch":82,"startBeat":5.75,"lengthBeats":0.582,"velocity":73},{"pitch":94,"startBeat":7,"lengthBeats":0.194,"velocity":108},{"pitch":84,"startBeat":7.25,"lengthBeats":0.291,"velocity":99},{"pitch":74,"startBeat":7.625,"lengthBeats":0.375,"velocity":78}],[{"pitch":80,"startBeat":0,"lengthBeats":0.188,"velocity":80},{"pitch":80,"startBeat":0.25,"lengthBeats":0.376,"velocity":87},{"pitch":79,"startBeat":0.75,"lengthBeats":0.188,"velocity":83},{"pitch":94,"startBeat":1,"lengthBeats":0.188,"velocity":80},{"pitch":82,"startBeat":1.25,"lengthBeats":0.188,"velocity":93},{"pitch":79,"startBeat":1.5,"lengthBeats":0.188,"velocity":104},{"pitch":82,"startBeat":1.75,"lengthBeats":0.188,"velocity":96},{"pitch":74,"startBeat":2,"lengthBeats":0.376,"velocity":106},{"pitch":80,"startBeat":2.5,"lengthBeats":0.282,"velocity":89},{"pitch":79,"startBeat":2.875,"lengthBeats":0.564,"velocity":78},{"pitch":77,"startBeat":4.125,"lengthBeats":0.564,"velocity":75},{"pitch":94,"startBeat":4.875,"lengthBeats":0.282,"velocity":69},{"pitch":75,"startBeat":5.25,"lengthBeats":0.376,"velocity":75},{"pitch":74,"startBeat":5.75,"lengthBeats":0.376,"velocity":75},{"pitch":77,"startBeat":7,"lengthBeats":0.564,"velocity":111}]]`


## Readout

- Instrument generation is strongest when it can switch kind, wavetable stack, sample choice, envelope shape, and modulation at the same time.
- Beat generation is strongest when genre anchors stay intact but row count, texture rows, hit density, velocity spans, swing, and fills move materially between seeds.
- MIDI generation is strongest when one phrase changes rhythm, contour, voicing, pitch span, and note density while staying inside the selected role.
- Categories with flags should receive generator changes before UI changes; the UI can expose controls later, but the backend/procedural layer needs enough entropy first.
