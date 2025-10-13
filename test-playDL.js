const play = require('play-dl');

async function testPlayDL() {
    console.log('Testing play-dl streaming...');
    
    const testUrl = 'https://www.youtube.com/watch?v=7SHAKi8l7Ls';
    const shortUrl = 'https://youtu.be/7SHAKi8l7Ls';
    
    try {
        console.log('1. Testing URL validation:');
        const validation = play.yt_validate(testUrl);
        console.log('   URL validation result:', validation);
        
        console.log('2. Testing video basic info:');
        const basicInfo = await play.video_basic_info(testUrl);
        console.log('   Video title:', basicInfo.video_details.title);
        
        console.log('3. Testing video info:');
        const videoInfo = await play.video_info(testUrl);
        console.log('   Video info available:', !!videoInfo);
        
        console.log('4. Testing stream with long URL:');
        try {
            const stream1 = await play.stream(testUrl);
            console.log('   Stream success! Type:', stream1.type, 'Has stream:', !!stream1.stream);
        } catch (e) {
            console.log('   Stream failed:', e.message);
        }
        
        console.log('5. Testing stream with short URL:');
        try {
            const stream2 = await play.stream(shortUrl);
            console.log('   Stream success! Type:', stream2.type);
        } catch (e) {
            console.log('   Stream failed:', e.message);
        }
        
        console.log('6. Testing stream after setToken:');
        try {
            await play.setToken({});
            const stream3 = await play.stream(testUrl);
            console.log('   Stream success after setToken!');
        } catch (e) {
            console.log('   Stream failed after setToken:', e.message);
        }
        
        console.log('7. Testing stream_from_info:');
        try {
            const stream4 = await play.stream_from_info(videoInfo);
            console.log('   Stream from info success!');
        } catch (e) {
            console.log('   Stream from info failed:', e.message);
        }
        
    } catch (error) {
        console.error('Test failed:', error.message);
    }
}

testPlayDL();