import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useChatStore } from '../../src/store/ChatStore';

/** Route target for the nav bar's new-chat button: starts a chat, then returns. */
export default function NewChatRoute() {
  const router = useRouter();
  const { newConversation } = useChatStore();

  useEffect(() => {
    newConversation();
    router.replace('/');
  }, [newConversation, router]);

  return null;
}
