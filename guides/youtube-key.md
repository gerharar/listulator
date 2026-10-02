# Get a YouTube API key

**Used for:** searching YouTube playlists and channels.
**Site:** [console.cloud.google.com](https://console.cloud.google.com)
**Last checked:** _not yet written up_

The key comes from Google Cloud. It is free for personal use.

## 1. Create a project

Sign in to your Google account, open the [Google Cloud console](https://console.cloud.google.com) and choose **Select a project → New project**:

- **Project name:** anything
- **Parent resource:** anything

<!-- TODO screenshot: images/youtube-1-new-project.png — the New project form -->

## 2. Turn on the YouTube Data API

Go to **APIs & Services → Enabled APIs & services** and click **Enable APIs and services**. Find **YouTube Data API v3** and enable it.

<!-- TODO screenshot: images/youtube-2-enable-api.png — the YouTube Data API v3 page with Enable -->

## 3. Create an API key

Click **Credentials → Create credentials → API key**, then set:

- **Name:** anything
- **API restrictions:** YouTube Data API v3
- **Application restrictions:** none

<!-- TODO screenshot: images/youtube-3-create-key.png — the key's restrictions; hide the key -->

## 4. Copy the key into Listulator

Copy your API key, open **Settings → API keys** in Listulator, paste it into the YouTube row and press **Test**. The pill should say **Working**.
