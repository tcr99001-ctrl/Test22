/** @type {import('next').NextConfig} */
const nextConfig = {
  // 최신 자바스크립트 문법을 사용하는 라이브러리들을 강제로 변환(Transpile) 시킵니다.
  transpilePackages: ['undici', 'firebase', '@firebase/auth'],
};

module.exports = nextConfig;
