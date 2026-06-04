export function globToRegex(pattern: string): RegExp {
  let src = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*' && pattern[i + 1] === '*') {
      src += '.*';
      i++; // skip second *
    } else if (ch === '*') {
      src += '[^:.]*';
    } else if (ch === '?') {
      src += '[^:.]';
    } else if ('\\^$.[]{}()+|'.includes(ch)) {
      src += '\\' + ch;
    } else {
      src += ch;
    }
  }
  return new RegExp('^' + src + '$');
}
