try {
  await import('./bot.js');
} catch (error) {
  if (error?.name === 'ConfigError') {
    console.error(`\n✖ ${error.message}\n`);
  } else {
    console.error('\n✖ Failed to start the bot:\n');
    console.error(error);
  }
  process.exit(1);
}
