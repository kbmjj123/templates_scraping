import { Octokit } from '@octokit/rest';
import { execa } from 'execa';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv'

dotenv.config({
	path: '.env.local'
})

export class GitHubScanner {
	static octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

	static async cloneRepo(repoUrl: string) {
		const tempDir = path.join(process.env.TEMP_DIR!, Date.now().toString());
		await execa('git', ['clone', '--depth', '1', repoUrl, tempDir], {
			timeout: parseInt(process.env.CLONE_TIMEOUT || '30000'),
		});
		return tempDir;
	}

	static async fetchRepoStats(repoUrl: string) {
		if (!repoUrl.includes('github.com')) {
			throw new Error('Invalid GitHub repository URL');
		}

		const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
		if (!match || match.length < 3) {
			throw new Error('无法解析GitHub仓库URL格式');
		}

		const [owner, repo] = match.slice(1);
		const { data } = await this.octokit.repos.get({ owner, repo });

		return {
			stars: data.stargazers_count,
			forks: data.forks_count,
			lastCommit: data.pushed_at,
			license: data.license?.spdx_id,
			openIssues: data.open_issues_count
		};
	}

	// 获取贡献者数量
	static async fetchContributorsCount(repoUrl: string) {
		const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
		if (!match || match.length < 3) {
			throw new Error('无法解析GitHub仓库URL格式');
		}
		const [owner, repo] = match.slice(1);
		const { data } = await this.octokit.repos.listContributors({ owner, repo });
		return data.length;
	}
	

	static async cleanup(path: string) {
		await fs.rm(path, { recursive: true, force: true });
	}
}