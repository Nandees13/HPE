const axios = require('axios');
const { Octokit } = require('@octokit/rest');

// GitHub setup
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
const pullRequestNumber = process.env.GITHUB_REF.split('/')[2];

// Gemini setup
const geminiApiKey = process.env.GEMINI_API_KEY;
const geminiEndpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

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
            parts: [
              { text: prompt }
            ]
          }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
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

    // Get review from Gemini
    const review = await getGeminiReview(filteredDiff);

    // Post the review as a comment
    await postReviewComment(review);
  } catch (error) {
    console.error('Error in review process:', error.message);
    process.exit(1);
  }
})();
