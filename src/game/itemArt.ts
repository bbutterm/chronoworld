/** Temporary reuse of existing RO item art until the individual late-game images are imported. */
const ART_ALIASES: Readonly<Record<string, string>> = {
  magni_cap: 'helm', vidar_boots: 'boots', bone_helm: 'helm', fricco_shoes: 'shoes',
  morrigane_helm: 'helm', black_leather_boots: 'boots', fricca_circlet: 'crown', diabolus_boots: 'boots',
};

export const roItemArtId = (id: string): string => ART_ALIASES[id] ?? id;
