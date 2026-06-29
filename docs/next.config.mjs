import nextra from 'nextra'

const withNextra = nextra({ search: true })

export default withNextra({
  // Self-contained server build so the docs ship as a small standalone image
  // (the `learnhouse-docs` stack component) — keeps search (pagefind) + headers.
  output: 'standalone',
  trailingSlash: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ]
  },
})
