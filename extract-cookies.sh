#!/bin/bash

# YouTube Cookie Extraction Script for VPS
echo "🍪 YouTube Cookie Extraction Helper"
echo "===================================="
echo ""
echo "YouTube is blocking your VPS. You need fresh cookies from a logged-in browser."
echo ""
echo "Choose your method:"
echo "1) Extract from Chrome (on your local machine)"
echo "2) Extract from Firefox (on your local machine)"
echo "3) I have cookies.txt file ready"
echo ""
read -p "Enter choice (1-3): " choice

case $choice in
  1)
    echo ""
    echo "📋 Instructions for Chrome:"
    echo "1. On your LOCAL machine (not VPS), run:"
    echo ""
    echo "   yt-dlp --cookies-from-browser chrome --cookies cookies.txt --skip-download https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    echo ""
    echo "2. Upload the cookies.txt file to your VPS"
    echo "3. Place it at: /home/container/cookies.txt"
    ;;
    
  2)
    echo ""
    echo "📋 Instructions for Firefox:"
    echo "1. On your LOCAL machine (not VPS), run:"
    echo ""
    echo "   yt-dlp --cookies-from-browser firefox --cookies cookies.txt --skip-download https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    echo ""
    echo "2. Upload the cookies.txt file to your VPS"
    echo "3. Place it at: /home/container/cookies.txt"
    ;;
    
  3)
    echo ""
    echo "📁 Checking for cookies.txt..."
    if [ -f "/home/container/cookies.txt" ]; then
      echo "✅ Found cookies.txt!"
      echo "🔐 Validating cookies..."
      
      # Test cookies with yt-dlp
      yt-dlp --cookies /home/container/cookies.txt --skip-download -q https://www.youtube.com/watch?v=dQw4w9WgXcQ
      
      if [ $? -eq 0 ]; then
        echo "✅ Cookies are valid and working!"
        echo ""
        echo "📝 Update your .env file:"
        echo "COOKIES_PATH=/home/container/cookies.txt"
      else
        echo "❌ Cookies are invalid or expired. Please extract fresh cookies."
      fi
    else
      echo "❌ cookies.txt not found at /home/container/cookies.txt"
      echo "Please upload your cookies file first."
    fi
    ;;
esac

echo ""
echo "💡 Alternative: Use a proxy to bypass geo-blocks"
echo "Add to your .env file:"
echo "PROXY_URL=http://your-proxy:port"