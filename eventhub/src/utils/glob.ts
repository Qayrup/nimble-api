export function globToRegex(pattern: string, delimiter = ':./'): RegExp {
  const escaped = delimiter.replace(/[\]\\-]/g, '\\$&');
  const singleSegment = `[^${escaped}]*`;
  const singleChar = `[^${escaped}]`;

  let src = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*' && pattern[i + 1] === '*') {
      src += '.*';
      i++;
    } else if (ch === '*') {
      src += singleSegment;
    } else if (ch === '?') {
      src += singleChar;
    } else if ('\\^$.[]{}()+|'.includes(ch)) {
      src += '\\' + ch;
    } else {
      src += ch;
    }
  }
  return new RegExp('^' + src + '$');
}
