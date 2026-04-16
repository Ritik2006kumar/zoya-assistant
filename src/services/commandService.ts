export function processCommand(command: string): {
  actions: { action: string; url?: string }[];
  isBrowserAction: boolean;
} {
  const lowerCmd = command.toLowerCase().trim();
  const parts = lowerCmd.split(/\s+and\s+|\s+\+\s+|\s+phir\s+/);
  const results: { action: string; url?: string }[] = [];

  for (const part of parts) {
    const cmd = part.trim();
    
    // General Browsing: "Open [website name]"
    const openMatch = cmd.match(/^open\s+(.+)$/);
    if (
      openMatch &&
      !cmd.includes("youtube") &&
      !cmd.includes("spotify")
    ) {
      let website = openMatch[1].trim().replace(/\s+/g, "");
      if (!website.includes(".")) {
        website += ".com";
      }
      results.push({
        action: `Opening ${openMatch[1]}...`,
        url: `https://www.${website}`,
      });
      continue;
    }

    // Media Search: "Play [song/video] on YouTube"
    const ytMatch = cmd.match(/^play\s+(.+?)\s+on\s+youtube$/);
    if (ytMatch) {
      const query = encodeURIComponent(ytMatch[1].trim());
      results.push({
        action: `Playing ${ytMatch[1]} on YouTube.`,
        url: `https://www.youtube.com/results?search_query=${query}`,
      });
      continue;
    }

    // Media Search: "Search [query] on Spotify"
    const spotifyMatch = cmd.match(/^search\s+(.+?)\s+on\s+spotify$/);
    if (spotifyMatch) {
      const query = encodeURIComponent(spotifyMatch[1].trim());
      results.push({
        action: `Searching ${spotifyMatch[1]} on Spotify.`,
        url: `https://open.spotify.com/search/${query}`,
      });
      continue;
    }

    // WhatsApp Web
    const waMatch = cmd.match(
      /^send\s+a\s+whatsapp\s+message\s+to\s+([\d\+\s]+)\s+saying\s+(.+)$/,
    );
    if (waMatch) {
      const number = waMatch[1].replace(/\s+/g, "");
      const message = encodeURIComponent(waMatch[2].trim());
      results.push({
        action: `Sending WhatsApp message to ${number}.`,
        url: `https://web.whatsapp.com/send?phone=${number}&text=${message}`,
      });
      continue;
    }

    // VS Code
    if (cmd.includes("open vs code") || cmd.includes("open editor")) {
      results.push({
        action: "Opening VS Code Web.",
        url: "https://vscode.dev",
      });
      continue;
    }
  }

  return { 
    actions: results, 
    isBrowserAction: results.length > 0 
  };
}
