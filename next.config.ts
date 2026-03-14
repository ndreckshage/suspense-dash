import type { NextConfig } from "next";
import { execSync } from "child_process";

function getGitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "dev";
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_GIT_COMMIT: getGitCommit(),
  },
};

export default nextConfig;
