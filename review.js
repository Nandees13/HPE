const axios = require('axios');
const fetch = require('node-fetch');

const geminiApiKey = process.env.GEMINI_API_KEY;
const geminiEndpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

(async () => {
  // 1. Dynamically import Octokit
  const { Octokit } = await import('@octokit/rest');

  // 2. GitHub setup
  const octokit = new Octokit({auth: process.env.GITHUB_TOKEN,request: { fetch } });  
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
  const pullRequestNumber = process.env.GITHUB_REF.split('/')[2];

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

  // Function to get Gemini review
  async function getGeminiReview(diff) {
    try {
      const prompt = `Review the following code diff and provide detailed feedback on potential issues, best practices, and improvements:\n\n${diff}`;
      const response = await axios.post(
        `${geminiEndpoint}?key=${geminiApiKey}`,
        {
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ]
        },
        {
          headers: { 'Content-Type': 'application/json' }
        }
      );

      return response.data.candidates[0].content.parts[0].text || 'No feedback generated.';
    } catch (error) {
      console.error('Error calling Gemini API:', error.message);
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
        body: `**Gemini Review**\n\n${review}`,
      });
      console.log('Review comment posted successfully.');
    } catch (error) {
      console.error('Error posting comment:', error.message);
      process.exit(1);
    }
  }

  try {
    const diff = await getPullRequestDiff();

    // Exclude patterns
    const excludePatterns = ['**/*.json', '**/*.md'];
    const diffLines = diff.split('\n');
    const filteredDiff = diffLines
      .filter(line => !excludePatterns.some(pattern => {
        const fileLine = line.match(/^diff --git a\/(.+?) b\/(.+?)$/);
        if (fileLine) {
          const filePath = fileLine[1];
          const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
          return regex.test(filePath);
        }
        return false;
      }))
      .join('\n');

    if (!filteredDiff) {
      console.log('No reviewable changes after filtering.');
      return;
    }

    const review = await getGeminiReview(filteredDiff);
    await postReviewComment(review);
  } catch (error) {
    console.error('Error in review process:', error.message);
    process.exit(1);
  }
})();
