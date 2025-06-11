const axios = require('axios');
const { Octokit } = require('@octokit/rest');
const { execSync } = require('child_process');

// GitHub setup
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
const pullRequestNumber = process.env.GITHUB_REF.split('/')[2];

// Ollama setup
const ollamaAddress = process.env.OLLAMA_ADDRESS || 'http://localhost:11434';
const ollamaModel = 'codellama:7b';

// Function to get the pull request diff
async function getPullRequestDiff() {
  try {
    const { data: pr } = await octokit.pulls.get({
      owner,
      repo,
      pull_number: pullRequestNumber,
    });

    const diffUrl = pr.diff_url;
    const { data: diff } = await axios.get(diffUrl);
    return diff;
  } catch (error) {
    console.error('Error fetching PR diff:', error.message);
    process.exit(1);
  }
}

// Function to get CodeLlama review
async function getCodeLlamaReview(diff) {
  try {
    const prompt = `Review the following code diff and provide detailed feedback on potential issues, best practices, and improvements:\n\n${diff}`;
    const response = await axios.post(`${ollamaAddress}/api/generate`, {
      model: ollamaModel,
      prompt: prompt,
      stream: false,
    });

    return response.data.response || 'No feedback generated.';
  } catch (error) {
    console.error('Error calling Ollama:', error.message);
    process.exit(1);
  }
}

// Function to post review comment
async function postReviewComment(review) {
  try {
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: pullRequestNumber,
      body: `**CodeLlama Review**\n\n${review}`,
    });
    console.log('Review comment posted successfully.');
  } catch (error) {
    console.error('Error posting comment:', error.message);
    process.exit(1);
  }
}

// Main function
(async () => {
  try {
    // Get the diff
    const diff = await getPullRequestDiff();

    // Exclude patterns (similar to your previous setup)
    const excludePatterns = ['**/*.json', '**/*.md'];
    const diffLines = diff.split('\n');
    const filteredDiff = diffLines
      .filter(line => !excludePatterns.some(pattern => {
        const fileLine = line.match(/^diff --git a\/(.+?) b\/(.+?)$/);
        if (fileLine) {
          const filePath = fileLine[1];
          return excludePatterns.some(p => {
            const regex = new RegExp(p.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
            return regex.test(filePath);
          });
        }
        return false;
      }))
      .join('\n');

    if (!filteredDiff) {
      console.log('No reviewable changes after filtering.');
      return;
    }

    // Get review from CodeLlama
    const review = await getCodeLlamaReview(filteredDiff);

    // Post the review as a comment
    await postReviewComment(review);
  } catch (error) {
    console.error('Error in review process:', error.message);
    process.exit(1);
  }
})();
