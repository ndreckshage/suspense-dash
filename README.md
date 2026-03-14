This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Todos

- Vercel Env: This doesnt work when using vercel since lambdas etc. Rather than storing this remote ... we should adjust this so that generate load makes client side queries and then stores the results in browser memory etc.
- Component Improvement: Lets also improve some of our components. Every component in core pdp section should be individual. ATC for example shouldnt be with ProductOptions. Lets also adjust some of our query / component names. also all PascalCase
  -- shell => Layout
  -- pdp => title
- Number of calls: Would like to be able to easily see total number of queries / and calls to subgraphs. Filter by calls to subgraphs.
- Client queries: This is optimized for core server component render which is great. Would also like it to work to show client side queries too, so we can capture the full E2E picture of what queries are made SSR and what are made CSR.
- Update readme and a plan for how we would actually implement this for Datadog metrics. Is there a path to write to DD, use those metrics, but to power this interface?

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
