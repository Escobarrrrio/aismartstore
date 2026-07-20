/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import { Heading, Text } from 'npm:@react-email/components@0.0.22'
import { EmailShell, codeStyle, h1, noteBox, noteText, text } from './EmailShell.tsx'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <EmailShell preview="Your verification code">
    <Heading style={h1}>Confirm reauthentication</Heading>
    <Text style={text}>Use the code below to confirm your identity:</Text>
    <Text style={codeStyle}>{token}</Text>
    <div style={noteBox}>
      <Text style={noteText}>
        This code will expire shortly. If you didn't request this, you can safely ignore this
        email.
      </Text>
    </div>
  </EmailShell>
)

export default ReauthenticationEmail
