/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import { Button, Heading, Link, Text } from 'npm:@react-email/components@0.0.22'
import { EmailShell, button, h1, link, noteBox, noteText, text } from './EmailShell.tsx'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({ siteName, siteUrl, confirmationUrl }: InviteEmailProps) => (
  <EmailShell preview={`You've been invited to join ${siteName}`}>
    <Heading style={h1}>You've been invited</Heading>
    <Text style={text}>
      You've been invited to join{' '}
      <Link href={siteUrl} style={link}>
        <strong>{siteName}</strong>
      </Link>
      . Click the button below to accept the invitation and create your account.
    </Text>
    <Button style={button} href={confirmationUrl}>
      Accept Invitation
    </Button>
    <div style={noteBox}>
      <Text style={noteText}>
        If you weren't expecting this invitation, you can safely ignore this email.
      </Text>
    </div>
  </EmailShell>
)

export default InviteEmail
