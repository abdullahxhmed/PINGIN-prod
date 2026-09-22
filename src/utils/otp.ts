import crypto from 'crypto';

function generateOtp(): string {
  const max = 1000000; // 6 digits: 000000–999999
  const range = 256 ** 3; // 3 bytes = 0 to 16,777,215
  const limit = range - (range % max); // largest multiple of `max` within range

  let value: number;
  do {
    value = crypto.randomBytes(3).readUIntBE(0, 3);
  } while (value >= limit); // reject values that would cause bias, retry

  return String(value % max).padStart(6, '0');
}

export default generateOtp