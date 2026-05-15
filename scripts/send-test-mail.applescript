-- Personal OS — Test email via Apple Mail
-- Usage: osascript ~/personal-os/scripts/send-test-mail.applescript

tell application "Mail"
	set newMessage to make new outgoing message with properties {
		subject: "Personal OS — pipeline test",
		content: "This is a test from Cowork. Pipeline test.",
		sender: "ryanhankins.personalos@gmail.com",
		visible: false
	}
	tell newMessage
		make new to recipient at end of to recipients with properties {
			address: "ryanhankins.personalos@gmail.com"
		}
	end tell
	send newMessage
end tell

return "Sent"
