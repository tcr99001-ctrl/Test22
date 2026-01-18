export const metadata = {
  title: 'Avalon Online',
  description: 'The Resistance: Avalon',
}

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <head>
        {/* Tailwind CSS를 인터넷에서 바로 가져옵니다 (설치 필요 없음) */}
        <script src="https://cdn.tailwindcss.com"></script>
        <script dangerouslySetInnerHTML={{
          __html: `
            tailwind.config = {
              theme: {
                extend: {
                  animation: {
                    'spin-slow': 'spin 3s linear infinite',
                  }
                }
              }
            }
          `
        }} />
        <style dangerouslySetInnerHTML={{
          __html: `
            body {
              background-color: #020617; /* slate-950 */
              color: white;
            }
            /* 스크롤바 숨기기 */
            ::-webkit-scrollbar {
              width: 0px;
              background: transparent;
            }
          `
        }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
