import type { AudioLanguage } from '@contracts';

/**
 * How a number is said in clips of the annex of audio/script.md, language by language. French
 * follows its counting: « soixante et onze » is 60 + and + 11, « quatre-vingt-un » 80 + 1.
 * Wolof counts by five (*juróom benn* for six): its rule is set with the speaker, and until then
 * a number is not said in Wolof — `null`, so that the phrase is reported, never cut.
 */
export const NUMBER_RULES: Readonly<Record<AudioLanguage, ((value: number) => string[]) | null>> = {
  fr: frenchNumber,
  wo: null,
};

/** Up to 999 999: more than any count of birds or bags of a farm. */
export const LARGEST_NUMBER = 999_999;

function frenchNumber(value: number): string[] {
  if (!Number.isInteger(value) || value < 0 || value > LARGEST_NUMBER) {
    throw new RangeError(`No French clips for ${value}`);
  }
  if (value < 1000) {
    return value === 0 ? ['number-0'] : belowThousand(value);
  }
  const thousands = Math.floor(value / 1000);
  const rest = value % 1000;
  // « deux mille » is recorded whole up to « neuf mille »; « douze mille » is 12 + « mille ».
  const head = thousands < 10 ? [`number-${thousands * 1000}`] : [...belowThousand(thousands), 'number-1000'];
  return rest === 0 ? head : [...head, ...belowThousand(rest)];
}

function belowThousand(value: number): string[] {
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  const head = hundreds === 0 ? [] : [`number-${hundreds * 100}`];
  return rest === 0 ? head : [...head, ...belowHundred(rest)];
}

function belowHundred(value: number): string[] {
  if (value <= 20 || value === 70 || value === 80 || value === 90 || (value < 70 && value % 10 === 0)) {
    return [`number-${value}`];
  }
  if (value < 70) {
    const unit = value % 10;
    const tens = `number-${value - unit}`;
    return unit === 1 ? [tens, 'number-and', 'number-1'] : [tens, `number-${unit}`];
  }
  if (value < 80) {
    // soixante-douze, soixante et onze
    return value === 71 ? ['number-60', 'number-and', 'number-11'] : ['number-60', `number-${value - 60}`];
  }
  // quatre-vingt-un, quatre-vingt-onze: no « et » after eighty
  return ['number-80', `number-${value - 80}`];
}
