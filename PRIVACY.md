# Privacy

Cohort is built so that your data stays yours. This policy explains what the
software does and does not do with it.

## What we collect

Nothing. Cohort has no account, no sign-in, and no telemetry. The maintainers
run no server that receives your data and never see your vault, your prompts, or
your usage.

## Where your data lives

Everything runs on your own machine. The Cohort MCP server reads and writes a
git vault of markdown in a directory you choose. Records you ask the model to
remember are held as proposals for a human to approve, and they only ever become
files in that local vault.

## What leaves your machine

The only data that leaves your machine is what you send to your own git remote
when you run git yourself, exactly as with any other file in your repository.
Cohort makes no other network call. It does not phone home, and it contacts no
third-party service.

Cohort runs inside an AI client such as Claude Code. Anything you type into that
client is handled under that client's own privacy terms, not this one. Cohort
neither adds to nor changes what your client sends.

## Personal data

A vault can hold whatever your team writes into it, which may include names or
other personal data, and git history records the name and email of whoever
authored each change. All of this stays in your local vault and your own git
remote. Cohort does not transmit it anywhere else.

## Changes

If this policy changes, the update will appear in this file in the project
repository.

## Contact

Open an issue at https://github.com/magnusmage/cohort/issues.
