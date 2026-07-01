let seed = 0;

const defaultAlphabet =
  'useandom-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';

export const customAlphabet = (alphabet: string, defaultSize = 21) => {
  return (size = defaultSize) => {
    const current = seed++;
    let id = '';

    for (let index = 0; index < size; index++) {
      id += alphabet[(current + index) % alphabet.length];
    }

    return id;
  };
};

export const nanoid = customAlphabet(defaultAlphabet, 21);
